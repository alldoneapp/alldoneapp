'use strict'

/**
 * UserHelper - Shared utilities for user data operations
 * Centralizes common patterns like feedUser retrieval to eliminate code duplication
 */
class UserHelper {
    /**
     * Get user data formatted for feed generation
     * Handles all error cases with consistent defaults
     *
     * @param {Object} db - Firestore database instance
     * @param {string} userId - User ID to retrieve data for
     * @returns {Promise<Object>} feedUser object with uid, id, creatorId, name, email
     */
    static async getFeedUserData(db, userId) {
        if (!db) {
            throw new Error('Database instance is required')
        }

        if (!userId || typeof userId !== 'string') {
            throw new Error('Valid userId is required')
        }

        try {
            const userDoc = await db.collection('users').doc(userId).get()

            if (userDoc.exists) {
                const userData = userDoc.data()
                return {
                    uid: userId, // generateFeedModel expects 'uid' not 'id'
                    id: userId,
                    creatorId: userId,
                    name: userData.name || userData.displayName || 'User',
                    email: userData.email || '',
                }
            } else {
                // User document doesn't exist - use defaults
                console.warn(`User document not found for userId: ${userId}, using defaults`)
                return {
                    uid: userId,
                    id: userId,
                    creatorId: userId,
                    name: 'User',
                    email: '',
                }
            }
        } catch (error) {
            // Database error or other failure - use defaults
            console.warn('Could not get user data for feed, using defaults:', error.message)
            return {
                uid: userId,
                id: userId,
                creatorId: userId,
                name: 'User',
                email: '',
            }
        }
    }
}

module.exports = { UserHelper }
