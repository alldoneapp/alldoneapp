'use strict'

/**
 * Joining a project is a server operation (`joinProjectSecondGen`).
 *
 * The browser used to add itself: "Join" in the invitation popup, opening a template link and
 * opening one of a template's guides all batch-wrote `projects/{id}.userIds` plus the joiner's
 * membership arrays (usersFirestore.addUserToProject). `firestore.rules` only lets an existing
 * member update a project (and only lets a member vouch for a membership change on a user
 * document), so every one of those writes by a not-yet-member was refused: an invitation could not
 * be accepted, a template link could not place anybody into a guide unless a brand-new guide had to
 * be created, and a guide could not be joined at all. A client rule that lets a non-member add
 * itself cannot tell an invited user from anybody holding the project id, so the right to join is
 * decided here, from stored documents and the verified identity of the caller:
 *
 * - an invitation (`projectsInvitation/{projectId}/invitations`) naming the caller's uid, or the
 *   caller's Firebase-Auth-verified email (never `users/{uid}.email`, which is owner-writable);
 * - a project shared "With link" (`isShared === PROJECT_PUBLIC`): anyone holding the link may join,
 *   exactly what the popup offered. A "restricted" project (1) can only be copied, a private one (2)
 *   only joined by invitation. Guides are not joinable by link (see below);
 * - a guide (`parentTemplateId`) may be joined directly only by its template's creator or the
 *   administrator. Everybody else joins a guide through its template, which keeps each guide below
 *   MAX_USERS_IN_GUIDES;
 * - a template (`isTemplate`): the administrator joins the template itself; anybody who may open it
 *   (member, or the template is not private, the same test `copyTemplateObjectsSecondGen` applies)
 *   is placed in the template's last guide if it has room, otherwise in a new guide created here,
 *   together with the template's creator and the administrator.
 *
 * What it writes is what the client wrote: `userIds` on the project, `projectIds` plus
 * `guideProjectIds`/`templateProjectIds` on every added user, the joiner in the default workstream
 * (not for guides), the template's `guideProjectIds` for a new guide, and it consumes the caller's
 * invitations. All of it happens in one transaction. Feeds and followers stay with the client, which
 * writes them as a member once this returns (`utils/backends/Users/usersFirestore.js`).
 */

const { HttpsError } = require('firebase-functions/v2/https')

const PROJECT_PUBLIC = 0
const PROJECT_PRIVATE = 2
// Mirrors MAX_USERS_IN_GUIDES in components/SettingsView/ProjectsSettings/ProjectHelper.js.
const MAX_USERS_IN_GUIDES = 50
const DEFAULT_WORKSTREAM_ID = 'ws@default'

const JOINED_VIA = {
    MEMBER: 'member',
    INVITATION: 'invitation',
    LINK: 'link',
    GUIDE_OWNER: 'guide_owner',
    ADMINISTRATOR: 'administrator',
    TEMPLATE_GUIDE: 'template_guide',
}

function requireProjectId(value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
        throw new HttpsError('invalid-argument', 'projectId is required')
    }
    return value.trim()
}

function listOf(value) {
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : []
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))]
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function getCallerIdentity(request) {
    const uid = request?.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')
    const token = request.auth.token || {}
    // Only an address the identity provider verified identifies the invitee.
    const verifiedEmail = token.email_verified === true ? normalizeEmail(token.email) : ''
    return { uid, verifiedEmail }
}

function sharingOf(project) {
    // Mirrors firestore.rules: a project without isShared counts as private.
    return project.isShared === undefined || project.isShared === null ? PROJECT_PRIVATE : project.isShared
}

function canOpenTemplate(template, uid) {
    return listOf(template.userIds).includes(uid) || sharingOf(template) !== PROJECT_PRIVATE
}

function invitationMatchesCaller(invitation, identity) {
    if (!invitation) return false
    if (invitation.userId && invitation.userId === identity.uid) return true
    return !!identity.verifiedEmail && normalizeEmail(invitation.userEmail) === identity.verifiedEmail
}

/**
 * The template's last guide still has room for one more user. Its creator and the administrator are
 * in every guide and do not count against MAX_USERS_IN_GUIDES (guidesFirestore.js used the same
 * rule; it read the administrator from the template instead of the guide, which made the extra seat
 * depend on whether the administrator had once joined the template).
 */
function guideHasRoom(guide, templateCreatorId, administratorId) {
    if (!guide) return false
    const userIds = listOf(guide.userIds)
    let maxUsers = MAX_USERS_IN_GUIDES
    if (templateCreatorId && userIds.includes(templateCreatorId)) maxUsers++
    if (administratorId && administratorId !== templateCreatorId && userIds.includes(administratorId)) maxUsers++
    return userIds.length < maxUsers
}

/**
 * The membership arrays a user gains for a project, as computed values (the transaction read them).
 */
function membershipUpdate(userData, projectId, project, now, actorId) {
    const update = {
        projectIds: uniq([...listOf(userData.projectIds), projectId]),
        lastEditionDate: now,
        lastEditorId: actorId,
    }
    if (project.isTemplate === true) {
        update.templateProjectIds = uniq([...listOf(userData.templateProjectIds), projectId])
    } else if (project.parentTemplateId) {
        update.guideProjectIds = uniq([...listOf(userData.guideProjectIds), projectId])
    }
    return update
}

function guideAssistantId(template, guideId) {
    const templateAssistantId = typeof template.assistantId === 'string' ? template.assistantId : ''
    const globalAssistantIds = listOf(template.globalAssistantIds)
    const isGlobalAssistant = !templateAssistantId || globalAssistantIds.includes(templateAssistantId)
    // copyTemplateObjectsSecondGen copies a project assistant into the guide under this id.
    return isGlobalAssistant ? templateAssistantId : guideId + templateAssistantId
}

function buildGuideDocument({ template, templateId, guideId, callerId, memberIds, timezone, now, deps }) {
    const { buildProjectDocument, PROJECT_COLORS } =
        deps.projectDocumentBuilder || require('../MCP/mcpWorkspaceSetupTools')
    const generateSortIndex = deps.generateSortIndex || require('../Utils/HelperFunctionsCloud').generateSortIndex
    const templateCreatorId = template.templateCreatorId
    const guide = buildProjectDocument({
        userId: callerId,
        name: `${template.name || ''} ${listOf(template.guideProjectIds).length + 1}`.trim(),
        description: '',
        color: typeof template.color === 'string' && template.color ? template.color : PROJECT_COLORS[0],
        timezone,
        now,
        contactStatusEntries: [],
        actor: null,
    })
    delete guide.contactStatuses
    delete guide.createdVia
    const sortIndex = generateSortIndex()
    return {
        ...guide,
        // A guide is created in the name of its template's creator (utils/.../guidesFirestore.js).
        creatorId: templateCreatorId,
        userIds: memberIds,
        parentTemplateId: templateId,
        globalAssistantIds: listOf(template.globalAssistantIds),
        workstreamIds: [],
        sortIndexByUser: { [templateCreatorId]: sortIndex, [callerId]: sortIndex },
        assistantId: guideAssistantId(template, guideId),
    }
}

async function readAdministratorId(db, tx) {
    const ref = db.doc('roles/administrator')
    const snapshot = tx ? await tx.get(ref) : await ref.get()
    const userId = snapshot.exists ? snapshot.data()?.userId : ''
    return typeof userId === 'string' ? userId : ''
}

async function readUsers(tx, db, userIds) {
    const snapshots = await Promise.all(userIds.map(userId => tx.get(db.doc(`users/${userId}`))))
    const users = {}
    snapshots.forEach((snapshot, index) => {
        if (snapshot.exists) users[userIds[index]] = snapshot.data() || {}
    })
    return users
}

function writeMemberships(tx, db, users, userIds, projectId, project, now, actorId) {
    userIds.forEach(userId => {
        if (!users[userId]) return
        tx.update(db.doc(`users/${userId}`), membershipUpdate(users[userId], projectId, project, now, actorId))
    })
}

async function findCallerGuide(db, templateId, uid) {
    const snapshot = await db
        .collection('projects')
        .where('parentTemplateId', '==', templateId)
        .where('userIds', 'array-contains', uid)
        .limit(1)
        .get()
    return snapshot.docs[0] ? snapshot.docs[0].id : null
}

function resolveTimezone(requested, userData, deps) {
    const moment = deps.moment || require('moment-timezone')
    if (typeof requested === 'string' && requested && moment.tz.zone(requested)) return requested
    const preferred = typeof userData?.preferredTimezone === 'string' ? userData.preferredTimezone : ''
    return preferred && moment.tz.zone(preferred) ? preferred : 'UTC'
}

/**
 * Places the caller into a guide of `templateId` (or the template itself for the administrator).
 */
async function joinTemplate(db, identity, templateId, data, deps) {
    const now = deps.now ? deps.now() : Date.now()
    const [administratorId, templateSnapshot] = await Promise.all([
        readAdministratorId(db),
        db.doc(`projects/${templateId}`).get(),
    ])
    if (!templateSnapshot.exists) throw new HttpsError('not-found', 'Project not found')
    const templateData = templateSnapshot.data() || {}
    if (templateData.isTemplate !== true) throw new HttpsError('failed-precondition', 'Not a template')

    // The administrator, and anybody already in the template, works on the template itself.
    if ((administratorId && identity.uid === administratorId) || listOf(templateData.userIds).includes(identity.uid)) {
        return joinPlainProject(db, identity, templateId, deps, { administratorId, templateJoin: true })
    }

    const existingGuideId = await findCallerGuide(db, templateId, identity.uid)
    if (existingGuideId) {
        return {
            projectId: existingGuideId,
            requestedProjectId: templateId,
            joinedVia: JOINED_VIA.MEMBER,
            addedUserIds: [],
            previousUserIds: [],
            isGuide: true,
            isNewGuide: false,
            templateId,
        }
    }

    const newGuideRef = db.collection('projects').doc()

    return db.runTransaction(async tx => {
        const templateRef = db.doc(`projects/${templateId}`)
        const templateSnapshot = await tx.get(templateRef)
        const template = templateSnapshot.exists ? templateSnapshot.data() || {} : null
        const templateCreatorId =
            template && typeof template.templateCreatorId === 'string' ? template.templateCreatorId : ''
        if (
            !template ||
            template.isTemplate !== true ||
            !templateCreatorId ||
            !canOpenTemplate(template, identity.uid)
        ) {
            throw new HttpsError('permission-denied', 'Not a template you can join')
        }

        const guideIds = listOf(template.guideProjectIds)
        const lastGuideId = guideIds[guideIds.length - 1]
        const lastGuideSnapshot = lastGuideId ? await tx.get(db.doc(`projects/${lastGuideId}`)) : null
        const lastGuide =
            lastGuideSnapshot && lastGuideSnapshot.exists && lastGuideSnapshot.data()?.parentTemplateId === templateId
                ? lastGuideSnapshot.data()
                : null

        const memberIds = uniq([identity.uid, templateCreatorId, administratorId])
        const users = await readUsers(tx, db, memberIds)
        if (!users[identity.uid]) throw new HttpsError('failed-precondition', 'User not found')
        // Never put an id without a user document into a project.
        const existingMemberIds = memberIds.filter(userId => users[userId])

        if (guideHasRoom(lastGuide, templateCreatorId, administratorId)) {
            const previousUserIds = listOf(lastGuide.userIds)
            const addedUserIds = existingMemberIds.filter(userId => !previousUserIds.includes(userId))
            tx.update(db.doc(`projects/${lastGuideId}`), { userIds: uniq([...previousUserIds, ...addedUserIds]) })
            writeMemberships(tx, db, users, addedUserIds, lastGuideId, lastGuide, now, identity.uid)
            return {
                projectId: lastGuideId,
                requestedProjectId: templateId,
                joinedVia: JOINED_VIA.TEMPLATE_GUIDE,
                addedUserIds,
                previousUserIds,
                isGuide: true,
                isNewGuide: false,
                templateId,
            }
        }

        const guideId = newGuideRef.id
        const guide = buildGuideDocument({
            template,
            templateId,
            guideId,
            callerId: identity.uid,
            memberIds: existingMemberIds,
            timezone: resolveTimezone(data.timezone, users[identity.uid], deps),
            now,
            deps,
        })
        tx.set(newGuideRef, guide)
        tx.update(templateRef, { guideProjectIds: uniq([...guideIds, guideId]) })
        writeMemberships(tx, db, users, existingMemberIds, guideId, guide, now, identity.uid)
        return {
            projectId: guideId,
            requestedProjectId: templateId,
            joinedVia: JOINED_VIA.TEMPLATE_GUIDE,
            addedUserIds: existingMemberIds,
            previousUserIds: [],
            isGuide: true,
            isNewGuide: true,
            templateId,
        }
    })
}

/**
 * Decides whether the caller may join `project` directly, without writing anything.
 */
function resolveDirectJoinAccess({ project, identity, invitations, administratorId, templateCreatorId }) {
    const userIds = listOf(project.userIds)
    if (userIds.includes(identity.uid)) return JOINED_VIA.MEMBER
    if (invitations.some(invitation => invitationMatchesCaller(invitation, identity))) return JOINED_VIA.INVITATION
    if (project.isTemplate === true) {
        return administratorId && identity.uid === administratorId ? JOINED_VIA.ADMINISTRATOR : null
    }
    if (project.parentTemplateId) {
        if (identity.uid === administratorId || (templateCreatorId && identity.uid === templateCreatorId)) {
            return JOINED_VIA.GUIDE_OWNER
        }
        return null
    }
    return sharingOf(project) === PROJECT_PUBLIC ? JOINED_VIA.LINK : null
}

async function readTemplateCreatorId(db, tx, project) {
    if (!project.parentTemplateId) return ''
    const snapshot = await tx.get(db.doc(`projects/${project.parentTemplateId}`))
    const template = snapshot.exists ? snapshot.data() || {} : {}
    return template.isTemplate === true && typeof template.templateCreatorId === 'string'
        ? template.templateCreatorId
        : ''
}

async function joinPlainProject(db, identity, projectId, deps, options = {}) {
    const now = deps.now ? deps.now() : Date.now()
    const administratorId =
        options.administratorId !== undefined ? options.administratorId : await readAdministratorId(db)

    return db.runTransaction(async tx => {
        const projectRef = db.doc(`projects/${projectId}`)
        const projectSnapshot = await tx.get(projectRef)
        if (!projectSnapshot.exists) throw new HttpsError('not-found', 'Project not found')
        const project = projectSnapshot.data() || {}

        const invitationsSnapshot = await tx.get(db.collection(`projectsInvitation/${projectId}/invitations`))
        const invitations = invitationsSnapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...(doc.data() || {}) }))
        const templateCreatorId = await readTemplateCreatorId(db, tx, project)
        const joinedVia = resolveDirectJoinAccess({
            project,
            identity,
            invitations,
            administratorId,
            templateCreatorId,
        })
        if (!joinedVia) throw new HttpsError('permission-denied', 'You are not invited to this project')

        const users = await readUsers(tx, db, [identity.uid])
        if (!users[identity.uid]) throw new HttpsError('failed-precondition', 'User not found')

        const workstreamRef = db.doc(`projectsWorkstreams/${projectId}/workstreams/${DEFAULT_WORKSTREAM_ID}`)
        const workstreamSnapshot = project.parentTemplateId ? null : await tx.get(workstreamRef)

        const previousUserIds = listOf(project.userIds)
        const isNewMember = !previousUserIds.includes(identity.uid)
        if (isNewMember) tx.update(projectRef, { userIds: [...previousUserIds, identity.uid] })

        // Writing the membership arrays again for an existing member repairs a user document that
        // lost them; it changes nothing otherwise.
        const userUpdate = membershipUpdate(users[identity.uid], projectId, project, now, identity.uid)
        const callerInvitations = invitations.filter(invitation => invitationMatchesCaller(invitation, identity))
        const invitedProjectIds = listOf(users[identity.uid].invitedProjectIds)
        if (invitedProjectIds.includes(projectId)) {
            userUpdate.invitedProjectIds = invitedProjectIds.filter(id => id !== projectId)
        }
        tx.update(db.doc(`users/${identity.uid}`), userUpdate)
        callerInvitations.forEach(invitation => tx.delete(invitation.ref))

        if (workstreamSnapshot && workstreamSnapshot.exists) {
            const workstreamUserIds = listOf(workstreamSnapshot.data()?.userIds)
            if (!workstreamUserIds.includes(identity.uid)) {
                tx.update(workstreamRef, {
                    userIds: [...workstreamUserIds, identity.uid],
                    lastEditionDate: now,
                    lastEditorId: identity.uid,
                })
            }
        }

        return {
            projectId,
            requestedProjectId: projectId,
            joinedVia: isNewMember ? joinedVia : JOINED_VIA.MEMBER,
            addedUserIds: isNewMember ? [identity.uid] : [],
            previousUserIds,
            isGuide: !!project.parentTemplateId,
            isNewGuide: false,
            templateId: project.parentTemplateId || (options.templateJoin ? projectId : ''),
        }
    })
}

function projectSummary(projectId, project) {
    return {
        id: projectId,
        name: typeof project.name === 'string' ? project.name : '',
        color: typeof project.color === 'string' ? project.color : '',
        isShared: sharingOf(project),
        isTemplate: project.isTemplate === true,
        parentTemplateId: typeof project.parentTemplateId === 'string' ? project.parentTemplateId : '',
    }
}

/**
 * What the invitation popup needs before the caller is a member: an invitee of a private project
 * cannot read the project document, so the popup could not even show its name.
 */
async function previewProjectJoin(db, identity, projectId) {
    const [projectSnapshot, invitationsSnapshot, administratorId] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.collection(`projectsInvitation/${projectId}/invitations`).get(),
        readAdministratorId(db),
    ])
    if (!projectSnapshot.exists) throw new HttpsError('not-found', 'Project not found')
    const project = projectSnapshot.data() || {}
    const invitations = invitationsSnapshot.docs.map(doc => doc.data() || {})
    let templateCreatorId = ''
    if (project.parentTemplateId) {
        const templateSnapshot = await db.doc(`projects/${project.parentTemplateId}`).get()
        const template = templateSnapshot.exists ? templateSnapshot.data() || {} : {}
        if (template.isTemplate === true && typeof template.templateCreatorId === 'string') {
            templateCreatorId = template.templateCreatorId
        }
    }
    let access = resolveDirectJoinAccess({ project, identity, invitations, administratorId, templateCreatorId })
    if (!access && project.isTemplate === true && canOpenTemplate(project, identity.uid)) {
        access = JOINED_VIA.TEMPLATE_GUIDE
    }
    if (!access) {
        // A restricted project may be opened and copied by link, never joined.
        if (sharingOf(project) !== PROJECT_PRIVATE) return { project: projectSummary(projectId, project), access: null }
        throw new HttpsError('permission-denied', 'You are not invited to this project')
    }
    return { project: projectSummary(projectId, project), access }
}

/**
 * Declining an invitation removes the caller's invitations to the project. The invitation documents
 * are writable only by project members, so the invitee's browser could clear its own
 * invitedProjectIds but never the invitation the inviter still sees as pending.
 */
async function declineProjectInvitation(db, identity, projectId) {
    return db.runTransaction(async tx => {
        const invitationsSnapshot = await tx.get(db.collection(`projectsInvitation/${projectId}/invitations`))
        const userRef = db.doc(`users/${identity.uid}`)
        const userSnapshot = await tx.get(userRef)
        const callerInvitations = invitationsSnapshot.docs.filter(doc =>
            invitationMatchesCaller(doc.data() || {}, identity)
        )
        callerInvitations.forEach(doc => tx.delete(doc.ref))
        const invitedProjectIds = userSnapshot.exists ? listOf(userSnapshot.data()?.invitedProjectIds) : []
        if (invitedProjectIds.includes(projectId)) {
            tx.update(userRef, { invitedProjectIds: invitedProjectIds.filter(id => id !== projectId) })
        }
        return { projectId, declinedInvitations: callerInvitations.length }
    })
}

async function handleJoinProjectRequest(db, request, deps = {}) {
    const identity = getCallerIdentity(request)
    const data = request.data || {}
    const projectId = requireProjectId(data.projectId)

    if (data.preview === true) return previewProjectJoin(db, identity, projectId)
    if (data.decline === true) return declineProjectInvitation(db, identity, projectId)

    // Opening a template's link starts (or joins) a guide of it; an invitation to a template, like
    // every other direct join, makes the caller a member of the project itself.
    if (data.startGuide === true) return joinTemplate(db, identity, projectId, data, deps)
    return joinPlainProject(db, identity, projectId, deps)
}

module.exports = {
    handleJoinProjectRequest,
    resolveDirectJoinAccess,
    guideHasRoom,
    invitationMatchesCaller,
    JOINED_VIA,
    MAX_USERS_IN_GUIDES,
}
