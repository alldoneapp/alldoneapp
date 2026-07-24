const isPlainObject = value => {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

const sanitizeForFirestore = value => {
    if (value === undefined) return undefined
    if (Array.isArray(value)) {
        return value.map(item => sanitizeForFirestore(item)).filter(item => item !== undefined)
    }
    if (isPlainObject(value)) {
        const cleaned = {}
        Object.entries(value).forEach(([key, nestedValue]) => {
            const safeNestedValue = sanitizeForFirestore(nestedValue)
            if (safeNestedValue !== undefined) cleaned[key] = safeNestedValue
        })
        return cleaned
    }
    return value
}

class BatchWrapper {
    #batchs = []
    #batch
    #counter = 0
    #actionsLimit
    #db

    constructor(db, actionsLimit = 500) {
        this.#db = db
        this.#actionsLimit = actionsLimit
        // Initialize feedObjects for TaskService feed persistence
        this.feedObjects = {}
        // For feed context fallback when using old direct format
        this.currentProjectId = null
    }

    /**
     * Set the current project context for feed operations fallback
     * @param {string} projectId - Project ID
     */
    setProjectContext(projectId) {
        this.currentProjectId = projectId
    }

    initBatch() {
        this.#counter = 0
        this.#batch = this.#db.batch()
        this.#batchs.push(this.#batch)
    }

    update(ref, object) {
        if (this.#batchs.length === 0) this.initBatch()
        const safeObject = sanitizeForFirestore(object)
        if (!safeObject || Object.keys(safeObject).length === 0) return

        if (this.#counter < this.#actionsLimit) {
            this.#batch.update(ref, safeObject)
            this.#counter++
        } else {
            this.initBatch()
            this.update(ref, safeObject)
        }
    }

    set(ref, object, params) {
        if (this.#batchs.length === 0) this.initBatch()
        const safeObject = sanitizeForFirestore(object)
        if (safeObject === undefined) return

        if (this.#counter < this.#actionsLimit) {
            this.#batch.set(ref, safeObject, params)
            this.#counter++
        } else {
            this.initBatch()
            this.set(ref, safeObject, params)
        }
    }

    delete(ref) {
        if (this.#batchs.length === 0) this.initBatch()

        if (this.#counter < this.#actionsLimit) {
            this.#batch.delete(ref)
            this.#counter++
        } else {
            this.initBatch()
            this.delete(ref)
        }
    }

    async commit(doParallelActionsForBatchGroups) {
        // Process feed objects before committing batches
        await this._persistFeedObjects()

        if (doParallelActionsForBatchGroups) {
            const promises = []
            for (let i = 0; i < this.#batchs.length; i++) {
                promises.push(this.#batchs[i].commit())
            }
            await Promise.all(promises)
        } else {
            for (let i = 0; i < this.#batchs.length; i++) {
                await this.#batchs[i].commit()
            }
        }

        this.#batchs = []
        this.#batch = null
        this.#counter = 0
        this.feedObjects = {} // Clear feed objects after commit
        this.currentProjectId = null // Clear project context after commit
    }

    async _persistFeedObjects() {
        // Persist feed objects to Firestore if any exist
        console.log(
            'BatchWrapper: _persistFeedObjects called with',
            Object.keys(this.feedObjects).length,
            'feed objects'
        )
        if (Object.keys(this.feedObjects).length > 0) {
            for (const [objectId, feedData] of Object.entries(this.feedObjects)) {
                try {
                    // Handle both old and new formats for backward compatibility
                    let feedObject, projectId, objectType

                    if (feedData.feedObject && feedData.projectId && feedData.objectType) {
                        // New structured format from TaskService
                        feedObject = feedData.feedObject
                        projectId = feedData.projectId
                        objectType = feedData.objectType
                    } else if (feedData.type && (feedData.name || feedData.id)) {
                        // Old direct format - feed object passed directly
                        feedObject = feedData

                        // Try to determine project and object type from context or feed object
                        // This is a fallback - the new structured format is preferred
                        objectType =
                            feedData.type === 'task'
                                ? 'tasks'
                                : feedData.type === 'goal'
                                ? 'goals'
                                : feedData.type === 'note'
                                ? 'notes'
                                : feedData.type === 'contact'
                                ? 'contacts'
                                : feedData.type === 'project'
                                ? 'projects'
                                : feedData.type === 'user'
                                ? 'users'
                                : feedData.type === 'skill'
                                ? 'skills'
                                : feedData.type === 'assistant'
                                ? 'assistants'
                                : feedData.type

                        // Extract projectId from feed object or use a fallback
                        projectId = feedData.projectId || feedData.projectIDKey || this.currentProjectId || 'unknown'
                    } else {
                        console.warn(
                            'BatchWrapper: Invalid feed format for objectId:',
                            objectId,
                            'Expected either structured format {feedObject, projectId, objectType} or direct feed object with type property'
                        )
                        continue
                    }

                    if (feedObject && projectId && objectType) {
                        // Write feed object to feedsObjectsLastStates collection
                        const feedObjectRef = this.#db.doc(
                            `feedsObjectsLastStates/${projectId}/${objectType}/${objectId}`
                        )

                        // Use the existing batch system to add the feed object write
                        this.set(feedObjectRef, feedObject, { merge: true })
                        console.log(
                            'BatchWrapper: Successfully queued feed object for persistence:',
                            objectId,
                            'to',
                            feedObjectRef.path
                        )
                    } else {
                        console.warn('BatchWrapper: Could not resolve feed context for objectId:', objectId, {
                            feedObject: !!feedObject,
                            projectId,
                            objectType,
                        })
                    }
                } catch (error) {
                    console.error('Failed to persist feed object for objectId:', objectId, error)
                }
            }
        }
    }
}

module.exports = {
    BatchWrapper,
}
