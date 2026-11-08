'use strict'

// security audit 2026-11: projects/{pid}.userIds is the only membership authority, but the
// `invitation-remove` rule branch let any account add an arbitrary project id to its own
// users/{uid} membership lists. The rule is closed; this decides what an existing user document
// should lose so that every listed project is backed by the project's own userIds.
// Used by migration/removeUnbackedUserProjectIds.js.

const USER_PROJECT_ID_LISTS = Object.freeze([
    'projectIds',
    'guideProjectIds',
    'templateProjectIds',
    'archivedProjectIds',
    'copyProjectIds',
])

// Every project id listed anywhere on the user document, deduplicated.
function collectListedProjectIds(userData = {}) {
    const ids = new Set()
    USER_PROJECT_ID_LISTS.forEach(list => {
        const values = userData?.[list]
        if (Array.isArray(values)) values.forEach(id => typeof id === 'string' && id && ids.add(id))
    })
    return [...ids]
}

/**
 * Pure: given the user document and, per listed project id, that project's userIds (or null/undefined
 * when the project document does not exist), returns the removals and the Firestore update to apply.
 * A missing project counts as unbacked. Lists that lose nothing are left out of the update, so an
 * untouched user yields an empty update.
 */
function planUnbackedProjectIdRemovals(userId, userData = {}, projectUserIdsById = new Map()) {
    const lookup = projectUserIdsById instanceof Map ? projectUserIdsById : new Map(Object.entries(projectUserIdsById))
    const isBacked = projectId => {
        const userIds = lookup.get(projectId)
        return Array.isArray(userIds) && userIds.includes(userId)
    }

    const removals = []
    const update = {}
    USER_PROJECT_ID_LISTS.forEach(list => {
        const values = userData?.[list]
        if (!Array.isArray(values)) return
        const kept = []
        values.forEach(projectId => {
            if (isBacked(projectId)) kept.push(projectId)
            else removals.push({ list, projectId })
        })
        if (kept.length !== values.length) update[list] = kept
    })
    return { removals, update }
}

module.exports = { USER_PROJECT_ID_LISTS, collectListedProjectIds, planUnbackedProjectIdRemovals }
