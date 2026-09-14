'use strict'

const SUPPORTED_PROJECT_MOVE_TYPES = Object.freeze(['task', 'note', 'goal', 'contact', 'chat', 'skill'])

const PROJECT_MOVE_COLLECTION_TYPE = Object.freeze({
    task: 'tasks',
    note: 'notes',
    goal: 'goals',
    contact: 'contacts',
    chat: 'topics',
    skill: 'skills',
})

function normalizeProjectMoveType(objectType) {
    const normalized = String(objectType || '')
        .trim()
        .toLowerCase()
    const singular = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized
    return SUPPORTED_PROJECT_MOVE_TYPES.includes(singular) ? singular : null
}

function getProjectMoveCollectionType(objectType) {
    const normalized = normalizeProjectMoveType(objectType)
    return normalized ? PROJECT_MOVE_COLLECTION_TYPE[normalized] : null
}

module.exports = {
    PROJECT_MOVE_COLLECTION_TYPE,
    SUPPORTED_PROJECT_MOVE_TYPES,
    getProjectMoveCollectionType,
    normalizeProjectMoveType,
}
