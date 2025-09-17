/**
 * NoteValidator - Simple note validation
 * Mock implementation for testing purposes
 */

function validateNote(params, context) {
    if (!params.title || typeof params.title !== 'string' || params.title.trim() === '') {
        throw new Error('Note title is required and must be a non-empty string')
    }

    if (!params.userId || typeof params.userId !== 'string') {
        throw new Error('User ID is required for note creation')
    }

    if (!params.projectId || typeof params.projectId !== 'string') {
        throw new Error('Project ID is required for note creation')
    }

    return true
}

module.exports = {
    validateNote,
    default: { validateNote },
}
