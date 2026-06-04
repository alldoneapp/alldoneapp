'use strict'

// Pure helpers for resolving which projects are in scope for a user. Kept dependency-free and
// separate from assistantHelper so they can be unit-tested without loading the full assistant
// stack (openai, tiktoken, firebase-admin, ...).

const appendUniqueTrimmedIds = (target, ids) => {
    if (!Array.isArray(ids)) return
    ids.forEach(id => {
        if (typeof id === 'string' && id.trim() && !target.includes(id.trim())) {
            target.push(id.trim())
        }
    })
}

// Every project the user can reach, including archived and template projects. Used for access
// gating (e.g. "is the caller's project one the user can see?").
const getAccessibleProjectIdsFromUserData = userData => {
    const allIds = []
    appendUniqueTrimmedIds(allIds, userData?.projectIds)
    appendUniqueTrimmedIds(allIds, userData?.guideProjectIds)
    appendUniqueTrimmedIds(allIds, userData?.templateProjectIds)
    appendUniqueTrimmedIds(allIds, userData?.archivedProjectIds)
    return allIds
}

// Projects in scope for delegation (talk_to_assistant) target discovery: the user's ACTIVE
// projects only. Archived, template, and guide projects are excluded — their assistants should
// not be offered as delegation targets, and scanning them made the dynamic tool-schema build
// pathologically slow for accounts with many such projects.
//
// In this data model `projectIds` is the full set and archived/template/guide are markers within
// it, so "active" means projectIds minus archived minus template minus guide. This mirrors the
// active-project filter in assistantHelper's getOpenTasksForAllProjects.
const getDelegationScopeProjectIdsFromUserData = userData => {
    const excludedIds = new Set()
    const markExcluded = ids => {
        if (!Array.isArray(ids)) return
        ids.forEach(id => {
            if (typeof id === 'string' && id.trim()) excludedIds.add(id.trim())
        })
    }
    markExcluded(userData?.archivedProjectIds)
    markExcluded(userData?.templateProjectIds)
    markExcluded(userData?.guideProjectIds)

    const allIds = []
    const appendActiveIds = ids => {
        if (!Array.isArray(ids)) return
        ids.forEach(id => {
            if (typeof id !== 'string') return
            const trimmed = id.trim()
            if (trimmed && !excludedIds.has(trimmed) && !allIds.includes(trimmed)) {
                allIds.push(trimmed)
            }
        })
    }
    appendActiveIds(userData?.projectIds)
    return allIds
}

module.exports = {
    getAccessibleProjectIdsFromUserData,
    getDelegationScopeProjectIdsFromUserData,
}
