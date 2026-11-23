'use strict'

// The project wiki is on by default, for new projects and for the ones that existed before the
// default, as long as somebody in the project uses Alldone. "Uses" is the heartbeat definition of
// active (a login within 30 days, knowledgeBaseSchedule.js), the same rule that decides whether
// heartbeats, recurring assistant tasks and the scheduled calendar pull spend anything on a user.
//
// The default is a document, not a reading of a missing one. A project with no
// knowledgeBases/{projectId} document has never been configured, so it gets one here, switched on,
// with the usual defaults and an active member as its payer. A document that exists is a decision
// somebody made, so it is left alone, with two exceptions that only keep the default working:
//   - a wiki paused because its payer stopped using Alldone (the run clears nextRunAt and records
//     owner_inactive) runs again once they are back;
//   - a wiki the default switched on (enabledBy 'default') moves to another active member once its
//     payer has left the project or stopped using Alldone. A wiki a member switched on themselves
//     never changes hands this way; it simply waits for them.
// A wiki a member switched off stays off: that is the one choice the default must never undo.
//
// Who pays: the project's creator when they are an active member, otherwise the active member the
// default is being applied for. Guides (projects copied from a
// template, parentTemplateId) and templates are left out: a guide's creatorId is the template's
// author, who would otherwise pay for the wiki of every guide anybody ever started.
//
// Archived projects get ONE complete wiki build (AT-2893), and are not kept current after that
// (AT-3095). Archiving (users/{uid}.archivedProjectIds, per member) means "I am done with this
// project", not "forget what we learned in it": the one build is what makes a past project's
// knowledge searchable and readable for its members and their assistants. Once a wiki has caught up
// (hasKnowledgeBaseCaughtUp), a run for a payer who archived the project stops with
// `project_archived` and clears nextRunAt. Archiving is per member, so the project may still be in
// use by others: a wiki the default switched on then moves to an active member who has NOT archived
// it, and the creator is only preferred as payer while they have not archived it either. A member
// who archived a project only takes a wiki over that has not had its complete build yet. The payer reactivating the project resumes the
// wiki here (the sweep, or the user trigger when they come back).
//
// The first run waits for the payer's next nightly slot instead of starting at once: the default
// reaches every project of a user in the same pass, and the worker runs three wikis at a time.
//
// The default monthly Gold cap went from 500 to 3,000 with the news screening (AT-3126, Karsten
// 2026-11-23). A wiki the default switched on that still holds the untouched old default (500, never
// saved by a member: no `monthlyGoldCapSetBy`) is raised to the new default by the same passes, once:
// afterwards its cap is no longer the old default, so a second pass changes nothing. A wiki a member
// switched on, or whose cap a member set, keeps its cap. A wiki paused at the old cap resumes.
//
// Three callers, from cheapest to most complete: onCreateProject (a new project, right away), the
// user trigger when somebody comes back after 30 days (their projects, and their paused wikis), and
// the daily sweep over every active user, which is also what reaches the existing projects of users
// who never left.

const admin = require('firebase-admin')

const { ACTIVE_USER_WINDOW_MS } = require('../Assistant/assistantHeartbeatSchedule')
const { mapWithConcurrency } = require('../Utils/mapWithConcurrency')
const {
    DEFAULT_KNOWLEDGE_BASE_MODEL,
    DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    KNOWLEDGE_BASE_ENABLED_BY_DEFAULT,
    LEGACY_DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    isKnowledgeBasePausedAtMonthlyCap,
    getKnowledgeBasePath,
    hasKnowledgeBaseCaughtUp,
    isKnowledgeBasePausedForArchivedProject,
    isKnowledgeBasePausedForInactiveOwner,
    isKnowledgeBasePausedForDepartedOwner,
    isProjectArchivedForUser,
} = require('./knowledgeBaseModel')
const { isKnowledgeBaseOwnerActive, nextNightlyRunAt } = require('./knowledgeBaseSchedule')

const MAX_USERS_PER_SWEEP = 500
const MAX_PROJECTS_PER_USER = 300
const PROJECT_CONCURRENCY = 5

function isKnowledgeBaseProjectEligible(project) {
    return !!project && project.active !== false && project.isTemplate !== true && !project.parentTemplateId
}

function getProjectMemberIds(project) {
    return Array.isArray(project?.userIds) ? project.userIds : []
}

// Reads each user and project once per pass: a project shared by several active members is
// reached once for each of them.
function createReaders(db, { users = new Map(), projects = new Map() } = {}) {
    const read = (cache, path, id) => {
        if (!cache.has(id)) {
            cache.set(
                id,
                db
                    .doc(`${path}/${id}`)
                    .get()
                    .then(snapshot => (snapshot.exists ? snapshot.data() || {} : null))
            )
        }
        return cache.get(id)
    }
    return {
        loadUser: userId => read(users, 'users', userId),
        loadProject: projectId => read(projects, 'projects', projectId),
    }
}

async function resolveDefaultOwner({ projectId, project, userId, userData, loadUser, now }) {
    const creatorId = project.creatorId
    if (creatorId && creatorId !== userId && getProjectMemberIds(project).includes(creatorId)) {
        const creator = await loadUser(creatorId)
        if (isKnowledgeBaseOwnerActive(creator, now) && !isProjectArchivedForUser(creator, projectId)) {
            return { ownerUserId: creatorId, ownerData: creator }
        }
    }
    return { ownerUserId: userId, ownerData: userData }
}

function isKnowledgeBasePaused(data) {
    return (
        isKnowledgeBasePausedForInactiveOwner(data) ||
        isKnowledgeBasePausedForDepartedOwner(data) ||
        isKnowledgeBasePausedForArchivedProject(data)
    )
}

function buildDefaultKnowledgeBase({ projectId, ownerUserId, ownerData, now }) {
    return {
        projectId,
        enabled: true,
        enabledBy: KNOWLEDGE_BASE_ENABLED_BY_DEFAULT,
        ownerUserId,
        instructions: '',
        model: DEFAULT_KNOWLEDGE_BASE_MODEL,
        monthlyGoldCap: DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
        createdAt: now,
        enabledAt: now,
        updatedAt: now,
        nextRunAt: nextNightlyRunAt(now, ownerData),
    }
}

// Gone: left the project, stopped using Alldone, or archived a project whose wiki has had its one
// complete build (from then on the payer's wiki would stand still while others still use it).
async function isPayerGone(current, projectId, project, loadUser, now) {
    if (!current.ownerUserId || !getProjectMemberIds(project).includes(current.ownerUserId)) return true
    const payer = await loadUser(current.ownerUserId)
    if (!isKnowledgeBaseOwnerActive(payer, now)) return true
    return isProjectArchivedForUser(payer, projectId) && hasKnowledgeBaseCaughtUp(current)
}

function hasLegacyDefaultCap(data = {}) {
    return (
        data.enabled === true &&
        data.enabledBy === KNOWLEDGE_BASE_ENABLED_BY_DEFAULT &&
        Number(data.monthlyGoldCap) === LEGACY_DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP &&
        !data.monthlyGoldCapSetBy
    )
}

// Raises an untouched old default cap to the current default (AT-3126). Idempotent; true when it wrote.
async function upgradeLegacyDefaultCap({ db, ref, now }) {
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const latest = snapshot.exists ? snapshot.data() || {} : {}
        if (!hasLegacyDefaultCap(latest)) return false
        const update = {
            monthlyGoldCap: DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
            monthlyGoldCapDefaultRaisedAt: now,
            updatedAt: now,
        }
        // Paused at the old cap this month: the new cap is far above what it spent, so it runs again.
        if (isKnowledgeBasePausedAtMonthlyCap(latest, now)) {
            update.nextRunAt = now
            update.lastRunStopReason = null
        }
        transaction.update(ref, update)
        return true
    })
}

// Applies the default to one project for one member: 'enabled', 'resumed', 'taken_over' or why not.
async function applyKnowledgeBaseDefault({ db, projectId, project, userId, userData, loadUser, now }) {
    if (!isKnowledgeBaseProjectEligible(project)) return 'ineligible'
    if (!getProjectMemberIds(project).includes(userId)) return 'not_member'
    if (!isKnowledgeBaseOwnerActive(userData, now)) return 'inactive'

    const ref = db.doc(getKnowledgeBasePath(projectId))
    // Read outside the transaction first: nearly every pass finds a document it leaves alone, and
    // the payer lookups below must not run inside a transaction that may be retried.
    const existing = await ref.get()

    if (!existing.exists) {
        const owner = await resolveDefaultOwner({ projectId, project, userId, userData, loadUser, now })
        return db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            if (snapshot.exists) return 'unchanged'
            transaction.set(ref, buildDefaultKnowledgeBase({ projectId, now, ...owner }))
            return 'enabled'
        })
    }

    const current = existing.data() || {}
    if (current.enabled !== true) return 'unchanged'

    if (hasLegacyDefaultCap(current)) {
        try {
            if (await upgradeLegacyDefaultCap({ db, ref, now })) {
                console.log('[knowledge base] Raised a default wiki to the new default cap', { projectId })
            }
        } catch (error) {
            console.warn('[knowledge base] Could not raise the default cap', { projectId, error: error.message })
        }
    }

    const archivedForUser = isProjectArchivedForUser(userData, projectId)

    // The payer is active (checked above): a paused wiki runs again, unless the payer still has the
    // project archived and the wiki already had its complete build (the run would stop again).
    if (current.ownerUserId === userId) {
        if (!isKnowledgeBasePaused(current)) return 'unchanged'
        if (archivedForUser && hasKnowledgeBaseCaughtUp(current)) return 'unchanged'
        return db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            const latest = snapshot.exists ? snapshot.data() || {} : {}
            if (latest.ownerUserId !== userId || !isKnowledgeBasePaused(latest)) return 'unchanged'
            transaction.update(ref, { nextRunAt: nextNightlyRunAt(now, userData), updatedAt: now })
            return 'resumed'
        })
    }

    if (current.enabledBy !== KNOWLEDGE_BASE_ENABLED_BY_DEFAULT) return 'unchanged'
    // Somebody who archived the project only takes a wiki over to finish its one complete build.
    if (archivedForUser && hasKnowledgeBaseCaughtUp(current)) return 'unchanged'
    if (!(await isPayerGone(current, projectId, project, loadUser, now))) return 'unchanged'

    const owner = await resolveDefaultOwner({ projectId, project, userId, userData, loadUser, now })
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const latest = snapshot.exists ? snapshot.data() || {} : {}
        if (
            latest.enabled !== true ||
            latest.enabledBy !== KNOWLEDGE_BASE_ENABLED_BY_DEFAULT ||
            latest.ownerUserId !== current.ownerUserId
        ) {
            return 'unchanged'
        }
        transaction.update(ref, {
            ownerUserId: owner.ownerUserId,
            nextRunAt: Number.isFinite(latest.nextRunAt) ? latest.nextRunAt : nextNightlyRunAt(now, owner.ownerData),
            updatedAt: now,
        })
        return 'taken_over'
    })
}

function emptyStats() {
    return { enabled: 0, resumed: 0, taken_over: 0, unchanged: 0, ineligible: 0, failed: 0 }
}

function addResult(stats, result) {
    const key = ['enabled', 'resumed', 'taken_over', 'unchanged', 'failed'].includes(result) ? result : 'ineligible'
    stats[key] += 1
}

// Every project of one active member. A failing project is logged and counted, never thrown: the
// callers are a user trigger, a project trigger and a sweep, and none of them should fail for it.
async function applyKnowledgeBaseDefaultsForUser({
    db = admin.firestore(),
    userId,
    userData,
    now = Date.now(),
    readers,
}) {
    const stats = emptyStats()
    if (!userId || !isKnowledgeBaseOwnerActive(userData, now)) return stats
    const { loadUser, loadProject } = readers || createReaders(db)
    const allProjectIds = [...new Set(Array.isArray(userData.projectIds) ? userData.projectIds : [])].filter(
        projectId => typeof projectId === 'string' && projectId
    )
    // Archived projects are included (AT-2893), after the active ones, so that the bound cuts the
    // past projects of a very large account rather than its current ones.
    const projectIds = [
        ...allProjectIds.filter(projectId => !isProjectArchivedForUser(userData, projectId)),
        ...allProjectIds.filter(projectId => isProjectArchivedForUser(userData, projectId)),
    ].slice(0, MAX_PROJECTS_PER_USER)

    const results = await mapWithConcurrency(projectIds, PROJECT_CONCURRENCY, async projectId => {
        try {
            const project = await loadProject(projectId)
            return await applyKnowledgeBaseDefault({ db, projectId, project, userId, userData, loadUser, now })
        } catch (error) {
            console.error('[knowledge base] Could not apply the wiki default', {
                userId,
                projectId,
                error: error.message,
            })
            return 'failed'
        }
    })
    results.forEach(result => addResult(stats, result))
    return stats
}

// onCreateProject: the creator pays, if they are active (a brand-new account may not have logged in
// yet; the user trigger and the sweep reach the project then).
async function applyKnowledgeBaseDefaultForNewProject({ db = admin.firestore(), project, now = Date.now() }) {
    if (!project?.id || !project.creatorId) return 'ineligible'
    try {
        const readers = createReaders(db)
        const userData = await readers.loadUser(project.creatorId)
        return await applyKnowledgeBaseDefault({
            db,
            projectId: project.id,
            project,
            userId: project.creatorId,
            userData,
            loadUser: readers.loadUser,
            now,
        })
    } catch (error) {
        console.error('[knowledge base] Could not switch the wiki of a new project on', {
            projectId: project.id,
            error: error.message,
        })
        return 'failed'
    }
}

async function applyKnowledgeBaseDefaultsForActiveUsers({
    db = admin.firestore(),
    now = Date.now(),
    limit = MAX_USERS_PER_SWEEP,
} = {}) {
    const snapshot = await db
        .collection('users')
        .where('lastLogin', '>=', now - ACTIVE_USER_WINDOW_MS)
        .limit(limit)
        .get()

    const users = new Map(snapshot.docs.map(doc => [doc.id, Promise.resolve(doc.data() || {})]))
    const readers = createReaders(db, { users })
    const stats = emptyStats()
    let activeUsers = 0

    for (const doc of snapshot.docs) {
        const userData = doc.data() || {}
        // The query filtered on lastLogin, but a stored Timestamp sorts apart from a stored number.
        if (!isKnowledgeBaseOwnerActive(userData, now)) continue
        activeUsers += 1
        const userStats = await applyKnowledgeBaseDefaultsForUser({ db, userId: doc.id, userData, now, readers })
        for (const [key, value] of Object.entries(userStats)) stats[key] += value
    }

    console.log('[knowledge base] Wiki default applied', {
        activeUsers,
        ...stats,
        capped: snapshot.docs.length >= limit,
    })
    return { activeUsers, ...stats }
}

module.exports = {
    MAX_USERS_PER_SWEEP,
    MAX_PROJECTS_PER_USER,
    isKnowledgeBaseProjectEligible,
    buildDefaultKnowledgeBase,
    hasLegacyDefaultCap,
    applyKnowledgeBaseDefault,
    applyKnowledgeBaseDefaultsForUser,
    applyKnowledgeBaseDefaultForNewProject,
    applyKnowledgeBaseDefaultsForActiveUsers,
}
