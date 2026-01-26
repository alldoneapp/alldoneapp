/**
 * NoteService - Universal note management service
 *
 * This service provides a unified API for note creation, validation, and feed generation
 * that works across all platforms and contexts:
 * - MCP Server (Cloud Functions)
 * - Assistant Tool calls (Cloud Functions)
 * - Frontend UI components (React Native/Web)
 * - Backend operations (Cloud Functions)
 * - Any other note creation contexts
 */

// Import shared utilities (using dynamic imports for cross-platform compatibility)
let NoteModelBuilder, NoteValidator, NoteFeedGenerator, getNextNoteId

// Dynamic imports for cross-platform compatibility
async function loadDependencies() {
    if (!NoteModelBuilder) {
        try {
            // Try CommonJS first (Node.js/Cloud Functions)
            if (typeof require !== 'undefined') {
                NoteModelBuilder = require('./NoteModelBuilder')
                NoteValidator = require('./NoteValidator')
                NoteFeedGenerator = require('./NoteFeedGenerator')
                // Import getNextNoteId for human readable ID generation
                try {
                    const noteIdGenerator = require('./noteIdGenerator')
                    getNextNoteId = noteIdGenerator.getNextNoteId
                } catch (error) {
                    console.warn('NoteService: Failed to load getNextNoteId function:', error.message)
                    getNextNoteId = null
                }
            } else {
                // Fall back to ES6 imports (React Native/Web)
                const [nmb, nv, nfg] = await Promise.all([
                    import('./NoteModelBuilder'),
                    import('./NoteValidator'),
                    import('./NoteFeedGenerator'),
                ])
                NoteModelBuilder = nmb
                NoteValidator = nv
                NoteFeedGenerator = nfg
                // Try to import getNextNoteId for React Native/Web
                try {
                    // In React Native/Web environment, try the original path first
                    const notesFirestore = await import('../../utils/backends/Notes/notesFirestore')
                    getNextNoteId = notesFirestore.getNextNoteId
                } catch (error) {
                    // Fallback to Cloud Functions version
                    try {
                        const noteIdGenerator = await import('./noteIdGenerator')
                        getNextNoteId = noteIdGenerator.getNextNoteId
                    } catch (fallbackError) {
                        console.warn('NoteService: Failed to load getNextNoteId function:', fallbackError.message)
                        getNextNoteId = null
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load NoteService dependencies:', error)
            throw new Error('NoteService initialization failed')
        }
    }
}

class NoteService {
    constructor(options = {}) {
        this.options = {
            // Database interface (Firestore admin, client, etc.)
            database: null,

            // Storage interface (Firebase Storage for note content)
            storage: null,

            // Moment.js instance for date handling
            moment: null,

            // Custom ID generator function
            idGenerator: null,

            // Batch operations support
            batchWrapper: null,

            // Environment-specific options
            isCloudFunction: typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR !== undefined,
            isReactNative: typeof navigator !== 'undefined' && navigator.product === 'ReactNative',
            isWeb: typeof window !== 'undefined',

            // Feature flags
            enableFeeds: true,
            enableValidation: true,
            enableBatching: true,

            // Override any defaults
            ...options,
        }

        this.initialized = false
    }

    /**
     * Initialize the service (load dependencies)
     */
    async initialize() {
        if (this.initialized) return

        await loadDependencies()
        this.initialized = true
    }

    /**
     * Ensure service is initialized
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize()
        }
    }

    /**
     * Generate a unique note ID
     * @returns {string} Unique note ID
     */
    generateNoteId() {
        if (this.options.idGenerator) {
            return this.options.idGenerator()
        }

        // Use database ID generation if available
        if (this.options.database && this.options.database.collection) {
            try {
                return this.options.database.collection('_').doc().id
            } catch (error) {
                // Fall through to default generation
            }
        }

        // Fallback ID generation
        return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    }

    /**
     * Create note content using Yjs format
     * @param {string} title - Note title
     * @param {string} content - Note content (optional)
     * @returns {Uint8Array} Encoded Yjs state
     */
    createNoteContent(title, content) {
        try {
            // Dynamic require for Yjs (only available in Node.js/Cloud Functions)
            const Y = require('yjs')

            const ydoc = new Y.Doc()
            const type = ydoc.getText('quill')

            // Create default content if none provided
            const noteContent = content || `# ${title}\n\nNote created via assistant.`

            // Insert the content into the Yjs document
            type.insert(0, noteContent)

            // Encode as binary for storage
            return Y.encodeStateAsUpdate(ydoc)
        } catch (error) {
            console.error('Failed to create note content with Yjs:', error)
            console.error('Error details:', error.message)

            // More detailed fallback - create a minimal Yjs document
            try {
                const Y = require('yjs')
                const ydoc = new Y.Doc()
                const type = ydoc.getText('quill')

                // Try basic insert instead of insertText
                const noteContent = content || `${title}\n\nNote created via assistant.`
                type.insert(0, noteContent)

                console.log('NoteService: Created fallback Yjs content successfully')
                return Y.encodeStateAsUpdate(ydoc)
            } catch (fallbackError) {
                console.error('Fallback Yjs creation also failed:', fallbackError)
                // Return empty Uint8Array if all else fails
                return new Uint8Array()
            }
        }
    }

    /**
     * Generate preview text from content
     * @param {string} content - Note content
     * @param {string} title - Note title (fallback if no content)
     * @returns {string} Preview text
     */
    generatePreview(content, title) {
        // Use content if available, otherwise create preview from title
        const textToPreview = content || `# ${title}\n\nNote created via assistant.`

        if (!textToPreview) return ''

        // Remove markdown headers and extract first few lines
        const cleanContent = textToPreview
            .replace(/^#+\s*/gm, '') // Remove markdown headers
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .trim()

        // Return first 100 characters (similar to frontend length)
        return cleanContent.length > 100 ? cleanContent.substring(0, 100) + '...' : cleanContent
    }

    /**
     * Validate note creation parameters
     * @param {Object} params - Note parameters
     * @param {Object} context - Creation context
     */
    async validateNoteCreation(params, context = null) {
        await this.ensureInitialized()

        // Basic validation
        if (!params.title || typeof params.title !== 'string' || params.title.trim() === '') {
            throw new Error('Note title is required and must be a non-empty string')
        }

        if (!params.userId || typeof params.userId !== 'string') {
            throw new Error('User ID is required for note creation')
        }

        if (!params.projectId || typeof params.projectId !== 'string') {
            throw new Error('Project ID is required for note creation')
        }

        // Advanced validation if enabled
        if (this.options.enableValidation && NoteValidator) {
            NoteValidator.validateNote(params, context)
        }
    }

    /**
     * Create a complete note object
     * @param {Object} params - Note creation parameters
     * @returns {Object} Complete note object
     */
    async buildNote(params) {
        await this.ensureInitialized()

        const noteId = params.noteId || this.generateNoteId()
        const now = params.now || Date.now()

        // Validate generated note ID
        if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error(`Failed to generate valid note ID: "${noteId}"`)
        }

        // Clean title and create extended title
        const cleanTitle = params.title.trim()
        const extendedTitle = params.extendedTitle || cleanTitle

        // Create note object following Alldone patterns (matching frontend structure)
        const note = {
            id: noteId,
            title: cleanTitle.toLowerCase(), // Alldone stores title in lowercase
            extendedTitle: extendedTitle,
            description: params.description || '', // Not used for content in notes
            preview: this.generatePreview(params.content, cleanTitle),
            userId: params.userId,
            creatorId: params.userId,
            projectId: params.projectId,

            // Privacy settings
            isPrivate: params.isPrivate || false,
            isPremium: false, // Default for assistant-created notes
            isPublicFor: params.isPublicFor || [0, params.userId],
            isVisibleInFollowedFor: params.isPublicFor || [params.userId],

            // Timestamps - Frontend expects both 'created' and 'createdAt'
            created: now,
            createdAt: now,
            lastEditionDate: now,
            lastEditorId: params.userId,

            // Comments data
            commentsData: {
                amount: 0,
                lastComment: '',
                lastCommentType: '',
            },

            // Additional fields
            hasStar: '#ffffff', // Default highlight color
            shared: false,
            views: 0,
            followersIds: [params.userId],

            // Sticky note settings
            stickyData: {
                days: 0,
                stickyEndDate: 0,
            },

            // Version and parent object info
            versionId: 'CURRENT_DAY_VERSION_ID',
            parentObject: params.parentObject || null,

            // Assistant info
            assistantId: params.assistantId || null,

            // Linking arrays (required by frontend)
            linkedParentAssistantIds: [],
            linkedParentContactsIds: [],
            linkedParentGoalsIds: [],
            linkedParentNotesIds: [],
            linkedParentProjectsIds: [],
            linkedParentSkillsIds: [],
            linkedParentTasksIds: [],

            // Linking maps (required by frontend)
            linkedParentsInContentIds: {
                linkedParentAssistantIds: [],
                linkedParentContactsIds: [],
                linkedParentGoalsIds: [],
                linkedParentNotesIds: [],
                linkedParentProjectsIds: [],
                linkedParentSkillsIds: [],
                linkedParentTasksIds: [],
            },
            linkedParentsInTitleIds: {
                linkedParentAssistantIds: [],
                linkedParentContactsIds: [],
                linkedParentGoalsIds: [],
                linkedParentNotesIds: [],
                linkedParentProjectsIds: [],
                linkedParentSkillsIds: [],
                linkedParentTasksIds: [],
            },

            // Template linking
            linkedToTemplate: false,
        }

        // Double-check the note has the ID field
        if (!note.id) {
            console.error('NoteService buildNote error: note object missing id field', {
                noteId,
                note_keys: Object.keys(note).slice(0, 10),
            })
            throw new Error('Note object is missing id field after creation')
        }

        return note
    }

    /**
     * Create note feed data
     * @param {string} eventType - Type of event ('created', 'followed', 'updated')
     * @param {Object} params - Feed parameters
     * @returns {Object} Feed data
     */
    async createNoteFeed(eventType, params) {
        await this.ensureInitialized()

        if (!this.options.enableFeeds) {
            return null
        }

        // Use existing feeds infrastructure if available
        try {
            const { generateNoteObjectModel } = require('../Feeds/notesFeedsHelper')
            const { generateCurrentDateObject, generateFeedModel } = require('../Feeds/globalFeedsHelper')

            const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
            const noteFeedObject = generateNoteObjectModel(currentMilliseconds, params.note, params.noteId)

            let entryText = 'created note'
            if (eventType === 'updated') {
                entryText = 'updated note'
            } else if (eventType === 'followed') {
                entryText = 'started following the note'
            }

            const { feed, feedId } = generateFeedModel({
                feedType: `FEED_NOTE_${eventType.toUpperCase()}`,
                lastChangeDate: currentMilliseconds,
                entryText: entryText,
                feedUser: params.feedUser,
                objectId: params.noteId,
                isPublicFor: noteFeedObject.isPublicFor,
            })

            return {
                feedId,
                feed,
                noteFeedObject,
                currentDateFormated,
            }
        } catch (error) {
            console.error('Failed to create note feed:', error)
            return null
        }
    }

    /**
     * Create a new note with all associated data (note object, content, feeds, etc.)
     * @param {Object} params - Note creation parameters
     * @param {string} params.title - Note title (required)
     * @param {string} params.content - Note content (optional)
     * @param {string} params.userId - User ID creating the note (required)
     * @param {string} params.projectId - Project ID (required)
     * @param {Object} params.feedUser - User object for feed creation
     * @param {Object} context - Additional context (permissions, etc.)
     * @returns {Object} Complete note creation result
     */
    async createNote(params, context = {}) {
        await this.ensureInitialized()

        const { feedUser, content, ...noteParams } = params

        // Step 1: Validate parameters
        await this.validateNoteCreation(noteParams, context)

        // Step 2: Build complete note object
        const note = await this.buildNote(noteParams)

        // Step 3: Create note content using Yjs
        const noteContent = this.createNoteContent(note.extendedTitle, content)

        // Step 4: Create feed data (if enabled)
        let feedData = null
        if (this.options.enableFeeds && feedUser) {
            try {
                feedData = await this.createNoteFeed('created', {
                    projectId: note.projectId || noteParams.projectId,
                    note,
                    noteId: note.id,
                    feedUser,
                })
            } catch (feedError) {
                console.error('Feed creation failed:', feedError)
                // Continue without feed if it fails
            }
        }

        return {
            note,
            noteContent,
            feedData,
            noteId: note.id,
            success: true,
            message: `Note "${note.extendedTitle}" created successfully`,
        }
    }

    /**
     * Persist note to database and storage
     * @param {Object} noteResult - Result from createNote()
     * @param {Object} options - Persistence options
     * @returns {Promise} Persistence result
     */
    async persistNote(noteResult, options = {}) {
        await this.ensureInitialized()

        if (!this.options.database) {
            throw new Error('Database interface not configured')
        }

        const { note, noteContent, feedData, noteId } = noteResult
        const { projectId, batch: externalBatch, feedUser } = options

        const finalProjectId = projectId || note.projectId
        if (!finalProjectId) {
            throw new Error('Project ID is required for note persistence')
        }

        // Validate note ID
        if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
            console.error('NoteService persistence error: invalid noteId', {
                noteId,
                noteResultKeys: Object.keys(noteResult),
                noteId_from_result: noteResult.noteId,
                noteId_from_note: note.id,
                note_keys: note ? Object.keys(note).slice(0, 10) : 'no note',
            })
            throw new Error(`Invalid note ID for persistence: "${noteId}". Note ID must be a non-empty string.`)
        }

        console.log('NoteService: Starting persistence for note:', noteId, 'in project:', finalProjectId)

        try {
            // SIMPLIFIED APPROACH: Direct persistence similar to frontend
            const noteRef = this.options.database.collection(`noteItems/${finalProjectId}/notes`).doc(noteId)

            console.log('NoteService: Setting note document at path:', `noteItems/${finalProjectId}/notes/${noteId}`)

            // Store note metadata (ensure title is lowercase like frontend)
            const noteToStore = {
                ...note,
                title: note.title.toLowerCase(),
            }
            await noteRef.set(noteToStore)

            console.log('NoteService: Note document stored successfully')

            // Store note content in Firebase Storage
            const storagePromises = []
            if (this.options.isCloudFunction && noteContent && noteContent.length > 0) {
                try {
                    const admin = require('firebase-admin')
                    const { defineString } = require('firebase-functions/params')

                    // Use MCP config (same pattern as other environment variables)
                    let notesBucketName

                    // First try MCP config
                    try {
                        const { getEnvironmentConfig } = require('../MCP/config/environments')
                        const config = getEnvironmentConfig()
                        notesBucketName = config.noteStorageBucket
                        console.log('NoteService: Got bucket name from MCP config:', notesBucketName)
                    } catch (mcpConfigError) {
                        console.log('NoteService: Failed to get from MCP config:', mcpConfigError.message)
                    }

                    // Fallback to envFunctionsHelper if MCP config fails
                    if (!notesBucketName) {
                        try {
                            const envHelper = require('../envFunctionsHelper')
                            const envFunctions = envHelper.getEnvFunctions()
                            notesBucketName = envFunctions.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET
                            console.log('NoteService: Got bucket name from envFunctionsHelper:', notesBucketName)
                        } catch (envHelperError) {
                            console.log('NoteService: Failed to get from envFunctionsHelper:', envHelperError.message)
                        }
                    }

                    if (!notesBucketName) {
                        // Last resort: try Firebase Functions parameter
                        try {
                            const { defineString } = require('firebase-functions/params')
                            notesBucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()
                            console.log(
                                'NoteService: Got bucket name from Firebase Functions parameter:',
                                notesBucketName
                            )
                        } catch (paramError) {
                            console.log('NoteService: Firebase Functions parameter failed:', paramError.message)
                        }
                    }

                    if (!notesBucketName) {
                        throw new Error(
                            'GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET not found in MCP config or envFunctionsHelper'
                        )
                    }

                    console.log('NoteService: Final bucket name:', notesBucketName)
                    const notesBucket = admin.storage().bucket(notesBucketName)
                    const storageRef = notesBucket.file(`notesData/${finalProjectId}/${noteId}`)

                    console.log(
                        'NoteService: Storing content to Firebase Storage:',
                        `notesData/${finalProjectId}/${noteId}`
                    )
                    storagePromises.push(storageRef.save(noteContent))
                } catch (storageError) {
                    console.error('NoteService: Failed to store note content:', storageError)
                }
            } else {
                console.log('NoteService: Skipping content storage - no content or not in Cloud Functions')
            }

            // Create feeds using the same approach as frontend
            if (feedData && this.options.enableFeeds && this.options.isCloudFunction) {
                try {
                    const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
                    const notesFeeds = require('../Feeds/notesFeeds')

                    if (notesFeeds && typeof notesFeeds.createNoteCreatedFeed === 'function') {
                        console.log('NoteService: Creating feed for note:', noteId)

                        const feedsBatch = new BatchWrapper(this.options.database)
                        const creator = feedUser || { uid: note.userId, id: note.userId }

                        await notesFeeds.createNoteCreatedFeed(finalProjectId, note, noteId, feedsBatch, creator, true)

                        // Create follow feeds for the creator
                        await notesFeeds.createNoteFollowedFeed(finalProjectId, noteId, feedsBatch, creator, true)

                        console.log('NoteService: Committing feeds batch')
                        await feedsBatch.commit()
                        console.log('NoteService: Feeds committed successfully')
                    } else {
                        console.warn('NoteService: createNoteCreatedFeed function not available')
                    }
                } catch (feedPersistError) {
                    console.error('NoteService: Failed to create feeds:', feedPersistError)
                }
            } else {
                console.log('NoteService: Skipping feeds - not enabled or not in Cloud Functions')
            }

            // Wait for storage operations to complete
            if (storagePromises.length > 0) {
                console.log('NoteService: Waiting for storage operations to complete')
                await Promise.all(storagePromises)
                console.log('NoteService: Storage operations completed')
            }

            return {
                ...noteResult,
                persisted: true,
                projectId: finalProjectId,
            }
        } catch (error) {
            console.error('Note persistence failed:', error)
            throw new Error(`Failed to persist note: ${error.message}`)
        }
    }

    /**
     * Complete note creation with persistence
     * @param {Object} params - Note creation parameters
     * @param {Object} context - Creation context
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Complete creation result
     */
    async createAndPersistNote(params, context = {}, options = {}) {
        const noteResult = await this.createNote(params, context)

        // Ensure projectId is available for persistence
        const persistOptions = {
            ...options,
            projectId: options.projectId || params.projectId || context.projectId,
            // Pass feedUser forward so persistence can generate inner feeds in CF
            feedUser: params.feedUser,
        }

        return await this.persistNote(noteResult, persistOptions)
    }

    /**
     * Update and persist an existing note with content prepending and date stamp
     * @param {Object} params - Update parameters
     * @param {string} params.noteId - Note ID to update
     * @param {string} params.projectId - Project ID containing the note
     * @param {Object} params.currentNote - Current note data
     * @param {string} [params.content] - New content to prepend with date stamp
     * @param {string} [params.title] - New title for the note
     * @param {Object} [params.feedUser] - User object for feed generation
     * @returns {Object} Update result
     */
    async updateAndPersistNote(params) {
        await this.ensureInitialized()

        const { noteId, projectId, currentNote, content: newContent, title: newTitle, feedUser } = params

        if (!noteId || typeof noteId !== 'string' || noteId.trim() === '') {
            throw new Error('Note ID is required for updating')
        }

        if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
            throw new Error('Project ID is required for updating')
        }

        if (!currentNote || typeof currentNote !== 'object') {
            throw new Error('Current note data is required for updating')
        }

        if (!newContent && !newTitle) {
            throw new Error('At least content or title must be provided for update')
        }

        const db = this.options.database
        if (!db) {
            throw new Error('Database interface is required for note updates')
        }

        // Import moment for date formatting
        const moment = this.options.moment || (typeof require !== 'undefined' ? require('moment') : null)
        if (!moment) {
            throw new Error('Moment.js is required for date stamp generation')
        }

        try {
            const updateData = {}
            const changes = []

            // Handle title update
            if (newTitle !== undefined && newTitle !== currentNote.title) {
                updateData.title = newTitle
                updateData.extendedTitle = newTitle // Alldone requires both title and extendedTitle
                changes.push(`title to "${newTitle}"`)
            }

            // Handle content update - replicate the note toolbar date button behavior
            if (newContent !== undefined) {
                // Get user's date format (fallback to DD.MM.YYYY for European format)
                const dateFormat = 'DD.MM.YYYY' // Default European format like the toolbar
                const dateStamp = moment().format(`${dateFormat} `)

                // Store the content parts for Yjs insertion (date + newline with header + content)
                this._dateStamp = dateStamp
                this._newContent = newContent

                console.log(`NoteService: Prepared date stamp: "${dateStamp}" and content length: ${newContent.length}`)

                // Don't update Firestore at all for content-only changes to avoid triggering cloud functions
                changes.push('content added with date stamp and header formatting (storage only)')
            }

            // Handle storage-only updates (content changes)
            if (newContent !== undefined && this._dateStamp && this._newContent) {
                await this.addFormattedContentToStorage(projectId, noteId, this._dateStamp, this._newContent, feedUser)
                // Clear the pending content
                delete this._dateStamp
                delete this._newContent

                // Content update handled entirely in addFormattedContentToStorage
                console.log(
                    'NoteService: Content update completed with proper Yjs formatting, metadata and feed generation'
                )
            }

            // Only update Firestore if there are metadata changes (title, etc.)
            if (Object.keys(updateData).length > 0) {
                const noteDocRef = db.doc(`noteItems/${projectId}/notes/${noteId}`)
                await noteDocRef.update(updateData)
                console.log(`NoteService: Updated Firestore metadata with ${Object.keys(updateData).length} changes`)
            } else if (newContent !== undefined) {
                // Content-only update - no Firestore changes needed
                console.log('NoteService: Content-only update, skipping Firestore to avoid triggering cloud functions')
            }

            if (Object.keys(updateData).length === 0 && newContent === undefined) {
                return {
                    success: true,
                    message: 'No changes to apply',
                    noteId,
                    updatedNote: currentNote,
                    changes: [],
                }
            }

            // Get updated note data (only if we updated Firestore)
            let updatedNote
            if (Object.keys(updateData).length > 0) {
                const noteDocRef = db.doc(`noteItems/${projectId}/notes/${noteId}`)
                const updatedNoteDoc = await noteDocRef.get()
                updatedNote = updatedNoteDoc.exists
                    ? { id: noteId, ...updatedNoteDoc.data() }
                    : { ...currentNote, ...updateData }
            } else {
                // For content-only updates, return the original note metadata
                updatedNote = { id: noteId, ...currentNote }
            }

            // Generate feed if enabled
            let feedData = null
            if (this.options.enableFeeds && feedUser) {
                try {
                    feedData = await this.createNoteFeed('updated', {
                        note: updatedNote,
                        projectId,
                        feedUser,
                        changes,
                    })
                } catch (feedError) {
                    console.warn('Failed to generate note update feed:', feedError.message)
                }
            }

            console.log('Note updated successfully:', {
                noteId,
                projectId,
                changes,
                feedGenerated: !!feedData,
            })

            return {
                success: true,
                noteId,
                message: `Note "${currentNote.title || 'Untitled'}" updated successfully`,
                updatedNote,
                changes,
                feedData,
                persisted: true,
            }
        } catch (error) {
            console.error('Error updating note:', error)
            throw new Error(`Failed to update note: ${error.message}`)
        }
    }

    /**
     * Update service configuration
     * @param {Object} newOptions - New configuration options
     */
    updateConfig(newOptions) {
        this.options = { ...this.options, ...newOptions }
    }

    /**
     * Get service configuration
     * @returns {Object} Current configuration
     */
    getConfig() {
        return { ...this.options }
    }

    /**
     * Get the correct notes storage bucket name using the same logic as other Firebase Functions
     */
    async getBucketName() {
        let bucketName =
            this.options.storageBucket ||
            process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET ||
            process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET_PROD

        if (bucketName) {
            console.log('NoteService: Got bucket name from options/env:', bucketName)

            // Validate bucket name matches current project environment
            let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
            if (!projectId) {
                try {
                    const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
                    if (cfg && cfg.projectId) projectId = cfg.projectId
                } catch (_) {}
            }
            if (!projectId && typeof require !== 'undefined') {
                try {
                    const admin = require('firebase-admin')
                    projectId = (admin.app() && admin.app().options && admin.app().options.projectId) || undefined
                } catch (_) {}
            }

            // Validate bucket matches project
            const expectedBucket =
                projectId === 'alldonealeph'
                    ? 'notescontentprod'
                    : projectId === 'alldonestaging'
                    ? 'notescontentstaging'
                    : 'notescontentdev'

            if (bucketName !== expectedBucket) {
                console.warn(
                    `NoteService: Bucket mismatch detected! Got "${bucketName}" but project "${projectId}" expects "${expectedBucket}". Ignoring misconfigured value.`
                )
                bucketName = null // Force fallback to correct bucket
            }
        }

        // Fallback to get bucket name using the same logic as createNote
        if (!bucketName) {
            try {
                const envHelper = require('../envFunctionsHelper')
                const envFunctions = envHelper.getEnvFunctions()
                bucketName = envFunctions.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET
                if (bucketName) console.log('NoteService: Got bucket name from envFunctionsHelper:', bucketName)
            } catch (envHelperError) {
                console.log('NoteService: Failed to get from envFunctionsHelper:', envHelperError.message)
            }
        }

        if (!bucketName) {
            // Last resort: try Firebase Functions parameter
            try {
                const { defineString } = require('firebase-functions/params')
                bucketName = defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET').value()
                if (bucketName)
                    console.log('NoteService: Got bucket name from Firebase Functions parameter:', bucketName)
            } catch (paramError) {
                console.log('NoteService: Firebase Functions parameter failed:', paramError.message)
            }
        }

        if (!bucketName) {
            // Smart fallback based on project ID with robust detection
            let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT

            if (!projectId) {
                try {
                    const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
                    if (cfg && cfg.projectId) projectId = cfg.projectId
                } catch (_) {}
            }

            // Try to get from admin app if available
            if (!projectId && typeof require !== 'undefined') {
                try {
                    const admin = require('firebase-admin')
                    projectId = (admin.app() && admin.app().options && admin.app().options.projectId) || undefined
                } catch (_) {}
            }

            console.log('NoteService: Detected project ID for fallback:', projectId)

            if (projectId === 'alldonealeph') {
                bucketName = 'notescontentprod'
                console.log('NoteService: Detected production project, using bucket:', bucketName)
            } else if (projectId === 'alldonestaging') {
                bucketName = 'notescontentstaging'
                console.log('NoteService: Detected staging project, using bucket:', bucketName)
            } else {
                bucketName = 'notescontentdev' // Final fallback
                console.warn('NoteService: Using fallback bucket name:', bucketName)
            }
        }

        return bucketName
    }

    /**
     * Get note content from Firebase Storage
     * @param {string} projectId - Project ID
     * @param {string} noteId - Note ID
     * @returns {string} Note content as plain text
     */
    async getStorageContent(projectId, noteId) {
        try {
            // Import Firebase storage if available
            let storage = this.options.storage
            if (!storage && typeof require !== 'undefined') {
                try {
                    const firebase = require('firebase-admin')
                    storage = firebase.storage()
                } catch (error) {
                    throw new Error('Firebase storage not available')
                }
            }

            if (!storage) {
                throw new Error('Storage interface not configured')
            }

            // Import Yjs for content decoding
            const Y = typeof require !== 'undefined' ? require('yjs') : null
            if (!Y) {
                throw new Error('Yjs not available for content decoding')
            }

            // Download from Firebase Storage
            const bucketName = await this.getBucketName()
            const storageRef = storage.bucket(bucketName).file(`notesData/${projectId}/${noteId}`)

            const [fileExists] = await storageRef.exists()
            if (!fileExists) {
                console.log(`NoteService: Storage file does not exist for note ${noteId}, returning empty content`)
                return ''
            }

            const [buffer] = await storageRef.download()
            console.log(`NoteService: Downloaded content from storage, size: ${buffer.length} bytes`)

            // Decode Yjs content
            const doc = new Y.Doc()
            Y.applyUpdate(doc, new Uint8Array(buffer))
            const ytext = doc.getText('quill')
            const content = ytext.toString()

            console.log(`NoteService: Decoded content length: ${content.length}`)
            return content
        } catch (error) {
            console.error('NoteService: Failed to get storage content:', error)
            throw error
        }
    }

    /**
     * Add formatted content to the beginning of existing note in Firebase Storage
     * Replicates the exact behavior of the note toolbar's date button
     * @param {string} projectId - Project ID
     * @param {string} noteId - Note ID
     * @param {string} dateStamp - Formatted date string (e.g., "29.12.2024 ")
     * @param {string} newContent - Content to add below the date
     * @param {Object} feedUser - User object for feed generation
     */
    async addFormattedContentToStorage(projectId, noteId, dateStamp, newContent, feedUser = null) {
        try {
            // Import Firebase storage if available
            let storage = this.options.storage
            if (!storage && typeof require !== 'undefined') {
                try {
                    const firebase = require('firebase-admin')
                    storage = firebase.storage()
                } catch (error) {
                    console.warn('NoteService: Firebase storage not available:', error.message)
                    return
                }
            }

            if (!storage) {
                console.warn('NoteService: Storage interface not configured, skipping content update')
                return
            }

            // Import Yjs for proper note content handling
            const Y = typeof require !== 'undefined' ? require('yjs') : null
            if (!Y) {
                console.warn('NoteService: Yjs not available, skipping storage content update')
                return
            }

            // Import markdown converter for formatting assistant content
            let markdownToYjs = null
            try {
                markdownToYjs = require('../Assistant/markdownToYjs')
            } catch (error) {
                console.warn('NoteService: markdownToYjs not available, will insert plain text')
            }

            // Load existing Yjs document and replicate toolbar date button behavior
            const bucketName = await this.getBucketName()
            console.log('NoteService: Using bucket name for update:', bucketName)
            const storageRef = storage.bucket(bucketName).file(`notesData/${projectId}/${noteId}`)

            // Load existing Yjs document state
            let doc = new Y.Doc()
            try {
                const [fileExists] = await storageRef.exists()
                if (fileExists) {
                    const [buffer] = await storageRef.download()
                    console.log(`NoteService: Loading existing Yjs document, size: ${buffer.length} bytes`)
                    Y.applyUpdate(doc, new Uint8Array(buffer))
                } else {
                    console.log(`NoteService: No existing document, creating new one`)
                }
            } catch (error) {
                console.log(`NoteService: Failed to load existing document, creating new:`, error.message)
                doc = new Y.Doc() // Fresh document
            }

            const ytext = doc.getText('quill')
            console.log(`NoteService: Current document length: ${ytext.length}`)

            // Replicate the exact toolbar date button behavior:
            // 1. Insert date text at position 0
            // 2. Insert newline with header 1 formatting after the date
            // 3. Insert new content after the header

            const insertPosition = 0
            let currentPosition = insertPosition

            // Step 1: Insert date text (plain text)
            ytext.insert(currentPosition, dateStamp)
            currentPosition += dateStamp.length
            console.log(`NoteService: Inserted date stamp at position ${insertPosition}, length: ${dateStamp.length}`)

            // Step 2: Insert newline with Header 1 formatting (only for the date line) + extra line break
            // In Quill, the header attribute on \n applies to the preceding line
            ytext.insert(currentPosition, '\n', { header: 1 })
            currentPosition += 1
            // Add a plain newline for spacing
            ytext.insert(currentPosition, '\n')
            currentPosition += 1
            console.log(`NoteService: Inserted header newline at position ${currentPosition - 2}`)

            // Step 3: Insert new content - check if it contains markdown and convert if so
            const hasMarkdown = markdownToYjs && markdownToYjs.containsMarkdown(newContent)
            console.log(`NoteService: Content markdown check: ${hasMarkdown}`)
            console.log(`NoteService: Content preview (first 200 chars): ${newContent.substring(0, 200)}`)

            if (hasMarkdown) {
                console.log(`NoteService: Detected markdown in content, converting to formatted text`)
                const contentStart = currentPosition
                currentPosition = markdownToYjs.insertMarkdownToYjs(ytext, currentPosition, newContent)
                // Add extra line breaks after content (plain, no formatting)
                ytext.insert(currentPosition, '\n\n\n')
                currentPosition += 3
                console.log(
                    `NoteService: Inserted markdown-formatted content at position ${contentStart}, length: ${
                        currentPosition - contentStart
                    }`
                )
            } else {
                // Plain text insertion - no formatting attributes
                ytext.insert(currentPosition, `${newContent}\n\n\n`)
                currentPosition += newContent.length + 3
                console.log(
                    `NoteService: Inserted plain content at position ${
                        currentPosition - newContent.length - 3
                    }, length: ${newContent.length}`
                )
            }

            console.log(`NoteService: Total document length after insertions: ${ytext.length}`)

            // Get the full document state
            const encodedStateData = Y.encodeStateAsUpdate(doc)

            console.log(`NoteService: Uploading to storage path: notesData/${projectId}/${noteId}`)

            await storageRef.save(Buffer.from(encodedStateData), {
                metadata: {
                    contentType: 'application/octet-stream',
                },
            })

            console.log(
                `NoteService: Added formatted content to storage for note ${noteId}, final encoded size: ${encodedStateData.length} bytes`
            )

            // Update preview in Firestore (like the normal app does in setNoteData)
            const fullContent = ytext.toString()
            const preview = fullContent.length > 150 ? fullContent.substring(0, 147) + '...' : fullContent

            const db = this.options.database
            if (db) {
                try {
                    await db.doc(`noteItems/${projectId}/notes/${noteId}`).update({
                        preview: preview,
                        lastEditionDate: Date.now(),
                    })
                    console.log(`NoteService: Updated preview in Firestore, length: ${preview.length}`)

                    // Generate feed for note edit (like startEditNoteFeedsChain)
                    if (this.options.enableFeeds && feedUser) {
                        await this.createNoteFeed('updated', {
                            note: { id: noteId, preview },
                            projectId,
                            feedUser,
                            changes: ['content updated'],
                        })
                        console.log(`NoteService: Generated feed for note update`)
                    }
                } catch (error) {
                    console.warn(`NoteService: Failed to update metadata:`, error.message)
                }
            }
        } catch (error) {
            console.error('NoteService: Failed to add formatted content to storage:', error)
            // Don't throw - let the update succeed even if storage update fails
        }
    }

    /**
     * Add content to the beginning of existing note in Firebase Storage
     * @param {string} projectId - Project ID
     * @param {string} noteId - Note ID
     * @param {string} contentToAdd - Content to prepend (includes date stamp)
     * @param {Object} feedUser - User object for feed generation
     */
    async addContentToStorage(projectId, noteId, contentToAdd, feedUser = null) {
        try {
            // Import Firebase storage if available
            let storage = this.options.storage
            if (!storage && typeof require !== 'undefined') {
                try {
                    const firebase = require('firebase-admin')
                    storage = firebase.storage()
                } catch (error) {
                    console.warn('NoteService: Firebase storage not available:', error.message)
                    return
                }
            }

            if (!storage) {
                console.warn('NoteService: Storage interface not configured, skipping content update')
                return
            }

            // Import Yjs for proper note content handling
            const Y = typeof require !== 'undefined' ? require('yjs') : null
            if (!Y) {
                console.warn('NoteService: Yjs not available, skipping storage content update')
                return
            }

            // Import markdown converter for formatting assistant content
            let markdownToYjs = null
            try {
                markdownToYjs = require('../Assistant/markdownToYjs')
            } catch (error) {
                console.warn('NoteService: markdownToYjs not available, will insert plain text')
            }

            // Load existing Yjs document and insert at beginning (atomic operation)
            const bucketName = await this.getBucketName()
            const storageRef = storage.bucket(bucketName).file(`notesData/${projectId}/${noteId}`)

            // Load existing Yjs document state
            let doc = new Y.Doc()
            try {
                const [fileExists] = await storageRef.exists()
                if (fileExists) {
                    const [buffer] = await storageRef.download()
                    console.log(`NoteService: Loading existing Yjs document, size: ${buffer.length} bytes`)
                    Y.applyUpdate(doc, new Uint8Array(buffer))
                } else {
                    console.log(`NoteService: No existing document, creating new one`)
                }
            } catch (error) {
                console.log(`NoteService: Failed to load existing document, creating new:`, error.message)
                doc = new Y.Doc() // Fresh document
            }

            const ytext = doc.getText('quill')
            console.log(`NoteService: Current document length: ${ytext.length}`)

            // Insert new content at the beginning - check if it contains markdown and convert if so
            if (markdownToYjs && markdownToYjs.containsMarkdown(contentToAdd)) {
                console.log(`NoteService: Detected markdown in content, converting to formatted text`)
                markdownToYjs.insertMarkdownToYjs(ytext, 0, contentToAdd)
            } else {
                ytext.insert(0, contentToAdd)
            }
            console.log(`NoteService: Inserted content at beginning, new length: ${ytext.length}`)

            // Get the full document state (not just the update)
            const encodedStateData = Y.encodeStateAsUpdate(doc)

            console.log(`NoteService: Uploading to storage path: notesData/${projectId}/${noteId}`)
            console.log(`NoteService: Added content preview: ${contentToAdd.substring(0, 100)}...`)

            await storageRef.save(Buffer.from(encodedStateData), {
                metadata: {
                    contentType: 'application/octet-stream',
                },
            })

            console.log(
                `NoteService: Added content to storage for note ${noteId}, final encoded size: ${encodedStateData.length} bytes`
            )

            // Update preview in Firestore (like the normal app does in setNoteData)
            const fullContent = ytext.toString()
            const preview = fullContent.length > 150 ? fullContent.substring(0, 147) + '...' : fullContent

            const db = this.options.database
            if (db) {
                try {
                    await db.doc(`noteItems/${projectId}/notes/${noteId}`).update({
                        preview: preview,
                        lastEditionDate: Date.now(),
                    })
                    console.log(`NoteService: Updated preview in Firestore, length: ${preview.length}`)

                    // Generate feed for note edit (like startEditNoteFeedsChain)
                    if (this.options.enableFeeds && feedUser) {
                        await this.createNoteFeed('updated', {
                            note: { id: noteId, preview },
                            projectId,
                            feedUser,
                            changes: ['content updated'],
                        })
                        console.log(`NoteService: Generated feed for note update`)
                    }
                } catch (error) {
                    console.warn(`NoteService: Failed to update metadata:`, error.message)
                }
            }
        } catch (error) {
            console.error('NoteService: Failed to add content to storage:', error)
            // Don't throw - let the update succeed even if storage update fails
        }
    }

    /**
     * Update note content in Firebase Storage
     * @param {string} projectId - Project ID
     * @param {string} noteId - Note ID
     * @param {string} content - New content to store (already includes prepended content with date stamp)
     */
    async updateStorageContent(projectId, noteId, content) {
        try {
            // Import Firebase storage if available
            let storage = this.options.storage
            if (!storage && typeof require !== 'undefined') {
                try {
                    const firebase = require('firebase-admin')
                    storage = firebase.storage()
                } catch (error) {
                    console.warn('NoteService: Firebase storage not available:', error.message)
                    return
                }
            }

            if (!storage) {
                console.warn('NoteService: Storage interface not configured, skipping content update')
                return
            }

            // Import Yjs and Quill for proper note content handling
            const Y = typeof require !== 'undefined' ? require('yjs') : null
            if (!Y) {
                console.warn('NoteService: Yjs not available, skipping storage content update')
                return
            }

            // Create a new Yjs document and replace all content
            const doc = new Y.Doc()
            const ytext = doc.getText('quill')

            console.log(`NoteService: Creating new Yjs document with content length: ${content.length}`)

            // Clear any existing content and insert the new content
            ytext.delete(0, ytext.length)
            ytext.insert(0, content)

            // Apply the update to get the encoded state
            const encodedStateData = Y.encodeStateAsUpdate(doc)

            // Upload to Firebase Storage
            const bucketName = await this.getBucketName()
            const storageRef = storage.bucket(bucketName).file(`notesData/${projectId}/${noteId}`)

            console.log(`NoteService: Uploading to storage path: notesData/${projectId}/${noteId}`)
            console.log(`NoteService: Content preview: ${content.substring(0, 100)}...`)

            await storageRef.save(Buffer.from(encodedStateData), {
                metadata: {
                    contentType: 'application/octet-stream',
                },
            })

            console.log(
                `NoteService: Updated storage content for note ${noteId}, encoded size: ${encodedStateData.length} bytes`
            )
        } catch (error) {
            console.error('NoteService: Failed to update storage content:', error)
            // Don't throw - let the Firestore update succeed even if storage update fails
        }
    }

    /**
     * Health check for the service
     * @returns {Object} Service status
     */
    async healthCheck() {
        try {
            await this.ensureInitialized()
            return {
                status: 'healthy',
                initialized: this.initialized,
                dependencies: {
                    NoteModelBuilder: !!NoteModelBuilder,
                    NoteValidator: !!NoteValidator,
                    NoteFeedGenerator: !!NoteFeedGenerator,
                },
                config: {
                    database: !!this.options.database,
                    storage: !!this.options.storage,
                    enableFeeds: this.options.enableFeeds,
                    enableValidation: this.options.enableValidation,
                    environment: this.options.isCloudFunction
                        ? 'cloud-function'
                        : this.options.isReactNative
                        ? 'react-native'
                        : this.options.isWeb
                        ? 'web'
                        : 'unknown',
                },
            }
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                initialized: this.initialized,
            }
        }
    }
}

// CommonJS export - works with Node.js and can be converted by bundlers
module.exports = {
    NoteService,
    default: NoteService,
}
