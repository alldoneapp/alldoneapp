'use strict'

const crypto = require('crypto')
const { normalizeEmailAddress } = require('../Email/emailChannelHelpers')
const { getContactEmails } = require('../shared/contactEmailHelper')

const MEETING_MAPPINGS_COLLECTION = 'menubarMeetingProjectMappings'
const MAX_PROJECTS_FOR_SIGNAL_MATCHING = 30
const MAX_ATTENDEE_EMAILS = 100
const MAX_CONTACTS_PER_PROJECT = 500
const USER_DOC_BATCH_SIZE = 100

const PROJECT_REFERENCE_STOP_WORDS = new Set([
    'project',
    'projekt',
    'product',
    'produkt',
    'work',
    'admin',
    'private',
    'privat',
    'meeting',
    'weekly',
    'daily',
    'sync',
    'call',
    'standup',
    'checkin',
    'review',
])

const normalizeProjectNameForLookup = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')

const normalizeTextForReference = value => {
    if (typeof value !== 'string') return ''
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
}

const getReferenceTokens = value => {
    return normalizeTextForReference(value)
        .split(' ')
        .filter(token => token.length >= 4 && !PROJECT_REFERENCE_STOP_WORDS.has(token))
}

const projectNamesMatch = (projectNameA, projectNameB) => {
    const a = normalizeProjectNameForLookup(projectNameA)
    const b = normalizeProjectNameForLookup(projectNameB)
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

/**
 * Stable key identifying a (likely recurring) meeting for the learned
 * meeting → project mapping. Prefers the caller-provided recurring/series id;
 * falls back to the normalized meeting title.
 */
function buildMeetingKey({ recurringKey, title } = {}) {
    const normalizedRecurringKey = typeof recurringKey === 'string' ? recurringKey.trim() : ''
    if (normalizedRecurringKey) {
        return crypto.createHash('sha256').update(`series:${normalizedRecurringKey}`).digest('hex')
    }
    const normalizedTitle = normalizeTextForReference(title)
    if (normalizedTitle) {
        return crypto.createHash('sha256').update(`title:${normalizedTitle}`).digest('hex')
    }
    return null
}

function normalizeAttendeeEmails(attendeeEmails, excludedEmails = []) {
    if (!Array.isArray(attendeeEmails)) return []
    const excluded = new Set(excludedEmails.map(normalizeEmailAddress).filter(Boolean))
    const seen = new Set()
    const normalized = []
    for (const email of attendeeEmails) {
        const normalizedEmail = normalizeEmailAddress(email)
        if (!normalizedEmail || seen.has(normalizedEmail) || excluded.has(normalizedEmail)) continue
        seen.add(normalizedEmail)
        normalized.push(normalizedEmail)
        if (normalized.length >= MAX_ATTENDEE_EMAILS) break
    }
    return normalized
}

/**
 * Pick the project whose known emails (members + contacts) overlap most with
 * the meeting attendees. Only returns a project when there is a strict winner.
 * @param {Array<{projectId: string, emails: Set<string>}>} projectEmailSets
 * @param {Array<string>} attendeeEmails - already normalized
 */
function scoreProjectsByAttendeeOverlap(projectEmailSets, attendeeEmails) {
    if (!Array.isArray(projectEmailSets) || attendeeEmails.length === 0) {
        return { projectId: null, score: 0, runnerUpScore: 0 }
    }

    let best = null
    let bestScore = 0
    let runnerUpScore = 0

    for (const { projectId, emails } of projectEmailSets) {
        if (!projectId || !emails) continue
        let score = 0
        for (const attendeeEmail of attendeeEmails) {
            if (emails.has(attendeeEmail)) score++
        }
        if (score > bestScore) {
            runnerUpScore = bestScore
            bestScore = score
            best = projectId
        } else if (score > runnerUpScore) {
            runnerUpScore = score
        }
    }

    if (bestScore >= 1 && bestScore > runnerUpScore) {
        return { projectId: best, score: bestScore, runnerUpScore }
    }
    return { projectId: null, score: bestScore, runnerUpScore }
}

/**
 * Match the meeting title against project names. Returns a project only when
 * the match is unambiguous.
 */
function findUniqueProjectByTitle(projects, meetingTitle) {
    const normalizedTitle = normalizeTextForReference(meetingTitle)
    if (!normalizedTitle || !Array.isArray(projects)) return null

    const namedProjects = projects.filter(project => project?.id && project.name)

    const fullNameMatches = namedProjects.filter(project => {
        const normalizedName = normalizeTextForReference(project.name)
        return !!normalizedName && normalizedTitle.includes(normalizedName)
    })
    if (fullNameMatches.length === 1) return fullNameMatches[0]
    if (fullNameMatches.length > 1) return null

    const titleTokens = normalizedTitle.split(' ')
    const tokenMatches = namedProjects.filter(project => {
        const projectTokens = getReferenceTokens(project.name)
        return projectTokens.some(token => titleTokens.some(titleToken => titleToken.startsWith(token)))
    })
    if (tokenMatches.length === 1) return tokenMatches[0]

    return null
}

async function loadMeetingMapping(db, userId, meetingKey) {
    if (!meetingKey) return null
    try {
        const mappingDoc = await db.collection(MEETING_MAPPINGS_COLLECTION).doc(`${userId}__${meetingKey}`).get()
        if (!mappingDoc.exists) return null
        const mappedProjectId = mappingDoc.data()?.projectId
        if (!mappedProjectId) return null

        // Validate the mapped project still exists and the user is a member
        const projectDoc = await db.collection('projects').doc(mappedProjectId).get()
        if (!projectDoc.exists) return null
        const projectData = projectDoc.data() || {}
        if (!Array.isArray(projectData.userIds) || !projectData.userIds.includes(userId)) return null

        return { id: mappedProjectId, name: projectData.name || null }
    } catch (error) {
        console.warn('menubarNoteProjectResolver: loading meeting mapping failed', error)
        return null
    }
}

async function saveMeetingMapping(db, { userId, meetingKey, projectId, meetingTitle, source }) {
    if (!meetingKey || !projectId) return
    try {
        await db
            .collection(MEETING_MAPPINGS_COLLECTION)
            .doc(`${userId}__${meetingKey}`)
            .set(
                {
                    userId,
                    meetingKey,
                    projectId,
                    meetingTitle: typeof meetingTitle === 'string' ? meetingTitle.slice(0, 300) : '',
                    source: source || 'unknown',
                    updatedAt: Date.now(),
                },
                { merge: true }
            )
    } catch (error) {
        console.warn('menubarNoteProjectResolver: saving meeting mapping failed', error)
    }
}

/**
 * Build per-project sets of known emails (project member emails + project
 * contact emails) for the attendee-overlap signal.
 */
async function loadProjectEmailSets(db, projects, requesterUserId) {
    const limitedProjects = projects.slice(0, MAX_PROJECTS_FOR_SIGNAL_MATCHING)

    // Resolve member emails once across all projects
    const memberIds = new Set()
    limitedProjects.forEach(project => {
        ;(project.userIds || []).forEach(memberId => {
            if (memberId && memberId !== requesterUserId) memberIds.add(memberId)
        })
    })

    const memberEmailById = new Map()
    const memberIdList = [...memberIds]
    for (let index = 0; index < memberIdList.length; index += USER_DOC_BATCH_SIZE) {
        const chunk = memberIdList.slice(index, index + USER_DOC_BATCH_SIZE)
        try {
            const userDocs = await db.getAll(...chunk.map(memberId => db.collection('users').doc(memberId)))
            userDocs.forEach(userDoc => {
                if (!userDoc.exists) return
                const email = normalizeEmailAddress(userDoc.data()?.email)
                if (email) memberEmailById.set(userDoc.id, email)
            })
        } catch (error) {
            console.warn('menubarNoteProjectResolver: loading member emails failed', error)
        }
    }

    const projectEmailSets = await Promise.all(
        limitedProjects.map(async project => {
            const emails = new Set()
            ;(project.userIds || []).forEach(memberId => {
                const email = memberEmailById.get(memberId)
                if (email) emails.add(email)
            })
            try {
                const contactsSnapshot = await db
                    .collection(`projectsContacts/${project.id}/contacts`)
                    .limit(MAX_CONTACTS_PER_PROJECT)
                    .get()
                contactsSnapshot.docs.forEach(contactDoc => {
                    getContactEmails(contactDoc.data() || {}).forEach(email => emails.add(email))
                })
            } catch (error) {
                console.warn(
                    `menubarNoteProjectResolver: loading contacts for project ${project.id} failed`,
                    error.message
                )
            }
            return { projectId: project.id, emails }
        })
    )

    return projectEmailSets
}

/**
 * Resolve the target project for a menubar note push.
 *
 * Cascade (strongest signal first):
 * 1. Explicit projectId from the app (validated against membership)
 * 2. projectName match (exact, then partial)
 * 3. Learned meeting → project mapping from previous pushes
 * 4. Attendee email overlap with project members + contacts
 * 5. Meeting title match against project names
 * 6. User's default project
 *
 * @returns {{ projectId, projectName, source, reasoning, meetingKey }}
 * @throws when no project can be resolved
 */
async function resolveMenubarNoteProject(
    db,
    {
        userId,
        userData = {},
        requestedProjectId,
        requestedProjectName,
        meetingTitle,
        meetingRecurringKey,
        attendeeEmails,
    }
) {
    const meetingKey = buildMeetingKey({ recurringKey: meetingRecurringKey, title: meetingTitle })

    let projectsPromise = null
    const loadProjects = () => {
        if (!projectsPromise) {
            const { ProjectService } = require('../shared/ProjectService')
            const projectService = new ProjectService({ database: db })
            projectsPromise = projectService
                .initialize()
                .then(() => projectService.getUserProjects(userId, { includeArchived: false, includeCommunity: false }))
        }
        return projectsPromise
    }

    // 1. Explicit projectId
    const normalizedRequestedProjectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : ''
    if (normalizedRequestedProjectId) {
        const projectDoc = await db.collection('projects').doc(normalizedRequestedProjectId).get()
        const projectData = projectDoc.exists ? projectDoc.data() || {} : null
        const isMember = !!projectData && Array.isArray(projectData.userIds) && projectData.userIds.includes(userId)
        if (!isMember) {
            const error = new Error('Project not found or not accessible')
            error.code = 'PROJECT_NOT_ACCESSIBLE'
            throw error
        }
        return {
            projectId: normalizedRequestedProjectId,
            projectName: projectData.name || null,
            source: 'explicitProjectId',
            reasoning: 'The menubar app explicitly targeted this project.',
            meetingKey,
        }
    }

    // 2. projectName match
    const normalizedRequestedProjectName = typeof requestedProjectName === 'string' ? requestedProjectName.trim() : ''
    if (normalizedRequestedProjectName) {
        const projects = await loadProjects()
        const normalizedLookupName = normalizeProjectNameForLookup(normalizedRequestedProjectName)
        const exactMatch = projects.find(
            project => normalizeProjectNameForLookup(project.name) === normalizedLookupName
        )
        const partialMatch = exactMatch
            ? null
            : projects.find(project => projectNamesMatch(project.name, normalizedRequestedProjectName))
        const matchingProject = exactMatch || partialMatch
        if (matchingProject) {
            return {
                projectId: matchingProject.id,
                projectName: matchingProject.name,
                source: exactMatch ? 'projectName_exact' : 'projectName_partial',
                reasoning: `The requested project name "${normalizedRequestedProjectName}" matched ${matchingProject.name}.`,
                meetingKey,
            }
        }
    }

    // 3. Learned meeting mapping
    const mappedProject = await loadMeetingMapping(db, userId, meetingKey)
    if (mappedProject) {
        return {
            projectId: mappedProject.id,
            projectName: mappedProject.name,
            source: 'learnedMeetingMapping',
            reasoning: `A previous note for this meeting was filed in ${mappedProject.name || 'this project'}.`,
            meetingKey,
        }
    }

    // 4. Attendee email overlap
    const normalizedAttendees = normalizeAttendeeEmails(attendeeEmails, [userData.email])
    if (normalizedAttendees.length > 0) {
        const projects = await loadProjects()
        const projectEmailSets = await loadProjectEmailSets(db, projects, userId)
        const overlap = scoreProjectsByAttendeeOverlap(projectEmailSets, normalizedAttendees)
        if (overlap.projectId) {
            const matchedProject = projects.find(project => project.id === overlap.projectId)
            return {
                projectId: overlap.projectId,
                projectName: matchedProject?.name || null,
                source: 'attendeeEmailMatch',
                reasoning: `${overlap.score} meeting attendee(s) matched members or contacts of ${
                    matchedProject?.name || 'this project'
                }.`,
                meetingKey,
            }
        }
    }

    // 5. Meeting title match
    if (meetingTitle) {
        const projects = await loadProjects()
        const titleMatch = findUniqueProjectByTitle(projects, meetingTitle)
        if (titleMatch) {
            return {
                projectId: titleMatch.id,
                projectName: titleMatch.name,
                source: 'meetingTitleMatch',
                reasoning: `The meeting title matched the project name ${titleMatch.name}.`,
                meetingKey,
            }
        }
    }

    // 6. Default project
    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (defaultProjectId) {
        const projectDoc = await db.collection('projects').doc(defaultProjectId).get()
        if (projectDoc.exists) {
            return {
                projectId: defaultProjectId,
                projectName: projectDoc.data()?.name || null,
                source: 'defaultProject',
                reasoning: 'No stronger signal matched, so the note was filed in your default project.',
                meetingKey,
            }
        }
    }

    const error = new Error('No project could be resolved. Specify a projectId or set a default project.')
    error.code = 'NO_PROJECT_RESOLVED'
    throw error
}

module.exports = {
    MEETING_MAPPINGS_COLLECTION,
    buildMeetingKey,
    normalizeAttendeeEmails,
    scoreProjectsByAttendeeOverlap,
    findUniqueProjectByTitle,
    resolveMenubarNoteProject,
    saveMeetingMapping,
}
