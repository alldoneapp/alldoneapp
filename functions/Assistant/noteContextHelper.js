/**
 * Note Context Helper for AI Assistant
 * Extracts @-mentioned notes from comments and fetches their content for assistant context
 */

const admin = require('firebase-admin')
const { getNoteDelta } = require('../QuillHelper')
const { deltaToMarkdown } = require('./deltaToMarkdown')

/**
 * Extract note IDs from comment text
 * @param {string} commentText - The comment text (might be JSON Delta or plain text)
 * @returns {Array<Object>} Array of note mention objects with noteId and projectId
 */
function extractMentionedNoteIds(commentText) {
    if (!commentText || typeof commentText !== 'string') {
        return []
    }

    const mentionedNotes = []

    try {
        // Try to parse as JSON Delta format
        const delta = JSON.parse(commentText)

        if (delta && delta.ops && Array.isArray(delta.ops)) {
            // Iterate through ops to find url objects with type === 'note'
            for (const op of delta.ops) {
                if (op.insert && typeof op.insert === 'object') {
                    const { url } = op.insert

                    // Check if this is a note mention
                    if (url && url.type === 'note' && url.objectId) {
                        // Extract projectId from URL if available
                        let projectId = null
                        if (url.url) {
                            // URL format: https://app.alldone.app/projects/{projectId}/notes/{noteId}/editor
                            const urlMatch = url.url.match(/\/projects\/([^/]+)\/notes\/([^/]+)/)
                            if (urlMatch) {
                                projectId = urlMatch[1]
                            }
                        }

                        mentionedNotes.push({
                            noteId: url.objectId,
                            projectId: projectId,
                            url: url.url,
                        })
                    }
                }
            }
        }
    } catch (e) {
        // Not JSON Delta format, might be plain text
        // Try to extract note URLs from plain text
        const noteUrlPattern = /https?:\/\/[^/]+\/projects\/([^/]+)\/notes\/([^/\s]+)/g
        let match
        while ((match = noteUrlPattern.exec(commentText)) !== null) {
            mentionedNotes.push({
                noteId: match[2],
                projectId: match[1],
                url: match[0],
            })
        }
    }

    return mentionedNotes
}

/**
 * Check if user has access to a note based on privacy settings
 * @param {Object} note - Note document data
 * @param {string} userId - User ID to check access for
 * @returns {boolean} True if user has access
 */
function checkNoteAccess(note, userId) {
    if (!note) {
        return false
    }

    // If note is not private, everyone has access
    if (!note.isPrivate) {
        return true
    }

    // Check if user is in isPublicFor array
    if (note.isPublicFor && Array.isArray(note.isPublicFor)) {
        // isPublicFor can contain userId or 0 (public for all)
        if (note.isPublicFor.includes(0) || note.isPublicFor.includes(userId)) {
            return true
        }
    }

    // Check if user is the creator
    if (note.creatorId === userId || note.userId === userId) {
        return true
    }

    return false
}

/**
 * Fetch note content from Firebase Storage and convert to markdown
 * @param {string} projectId - Project ID
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for privacy checks)
 * @param {string} url - Optional URL of the note mention
 * @returns {Promise<Object|null>} Object with title, url, and markdown content, or null if not accessible
 */
async function fetchNoteContentAsMarkdown(projectId, noteId, userId, url = null) {
    try {
        // Step 1: Fetch note metadata from Firestore
        const noteDoc = await admin.firestore().doc(`noteItems/${projectId}/notes/${noteId}`).get()

        if (!noteDoc.exists) {
            console.log(`Note ${noteId} not found in project ${projectId}`)
            return null
        }

        const noteData = noteDoc.data()

        // Step 2: Check privacy/access permissions
        if (!checkNoteAccess(noteData, userId)) {
            console.log(`User ${userId} does not have access to note ${noteId}`)
            return null
        }

        // Step 3: Fetch note content from Firebase Storage
        let noteContent = ''
        try {
            // Get bucket name from environment
            let bucketName = process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET

            if (!bucketName) {
                try {
                    const envHelper = require('../envFunctionsHelper')
                    const envFunctions = envHelper.getEnvFunctions()
                    bucketName = envFunctions.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET
                } catch (error) {
                    console.log('Could not get bucket name from envHelper:', error.message)
                }
            }

            if (!bucketName) {
                try {
                    const { defineString } = require('firebase-functions/params')
                    bucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()
                } catch (error) {
                    console.log('Could not get bucket name from Firebase params:', error.message)
                }
            }

            if (!bucketName) {
                bucketName = 'notescontentdev' // Fallback
                console.warn('Using fallback bucket name:', bucketName)
            }

            const bucket = admin.storage().bucket(bucketName)
            const storageRef = bucket.file(`notesData/${projectId}/${noteId}`)

            const [fileExists] = await storageRef.exists()
            if (fileExists) {
                const [buffer] = await storageRef.download()

                // Convert Yjs binary to Delta ops
                const deltaOps = getNoteDelta(buffer)

                // Convert Delta ops to markdown
                noteContent = deltaToMarkdown(deltaOps)
            } else {
                console.log(`Note content file does not exist for note ${noteId}`)
                // Use preview as fallback
                noteContent = noteData.preview || ''
            }
        } catch (storageError) {
            console.error(`Error fetching note content from storage:`, storageError)
            // Use preview as fallback
            noteContent = noteData.preview || ''
        }

        // Step 4: Format with title as header
        const noteTitle = noteData.extendedTitle || noteData.title || 'Untitled Note'
        const formattedContent = `## Note: ${noteTitle}\n\n${noteContent}`

        return {
            noteId,
            title: noteTitle,
            content: formattedContent,
            markdown: formattedContent,
            url: url || `https://app.alldone.app/projects/${projectId}/notes/${noteId}/editor`,
        }
    } catch (error) {
        console.error(`Error fetching note ${noteId}:`, error)
        return null
    }
}

/**
 * Fetch all mentioned notes from a comment and format for assistant context
 * @param {string} commentText - The comment text
 * @param {string} userId - User ID (for privacy checks)
 * @param {string} fallbackProjectId - Fallback project ID if not in URL
 * @returns {Promise<string>} Formatted markdown of all accessible notes
 */
async function fetchMentionedNotesContext(commentText, userId, fallbackProjectId) {
    const mentionedNotes = extractMentionedNoteIds(commentText)

    if (mentionedNotes.length === 0) {
        return ''
    }

    console.log(`Found ${mentionedNotes.length} mentioned notes in comment`)

    // Fetch all notes in parallel
    const notePromises = mentionedNotes.map(({ noteId, projectId, url }) => {
        const proj = projectId || fallbackProjectId
        if (!proj) {
            console.warn(`No project ID available for note ${noteId}, skipping`)
            return Promise.resolve(null)
        }
        return fetchNoteContentAsMarkdown(proj, noteId, userId, url)
    })

    const noteContents = await Promise.all(notePromises)

    // Filter out null results (inaccessible or not found notes)
    const accessibleNotes = noteContents.filter(note => note !== null)

    if (accessibleNotes.length === 0) {
        console.log('No accessible notes found')
        return ''
    }

    console.log(`Fetched ${accessibleNotes.length} accessible notes`)

    // Format each note with URL first, then title + content
    const formattedNotes = accessibleNotes.map(note => `${note.url}\n${note.content}`).join('\n\n')

    return `\n\nHere are the mentioned notes:\n${formattedNotes}`
}

module.exports = {
    extractMentionedNoteIds,
    checkNoteAccess,
    fetchNoteContentAsMarkdown,
    fetchMentionedNotesContext,
}
