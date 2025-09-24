/**
 * noteIdGenerator - Simple note ID generation for Cloud Functions
 *
 * This module provides note ID generation functionality for the NoteService
 * when running in Cloud Functions environment. It uses Firestore's built-in
 * ID generation for consistency with other parts of the system.
 */

const admin = require('firebase-admin')

/**
 * Generate a new note ID using Firestore's auto-ID generation
 * This ensures compatibility with existing ID generation patterns
 * @returns {string} A unique note ID
 */
function getNextNoteId() {
    try {
        // Use Firestore's built-in ID generation for consistency
        return admin.firestore().collection('_').doc().id
    } catch (error) {
        console.error('noteIdGenerator: Failed to generate note ID:', error)
        // Fallback to timestamp-based ID if Firestore fails
        return `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }
}

module.exports = {
    getNextNoteId,
}
