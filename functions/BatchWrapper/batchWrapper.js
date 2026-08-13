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
        for (const [objectId, feedData] of Object.entries(this.feedObjects)) {
            // Legacy feed helpers use feedObjects as an in-batch cache and already queue the
            // canonical last-state write through setFeedObjectLastState. Persisting those direct
            // objects here duplicates that write and, when no context was set, creates the bogus
            // feedsObjectsLastStates/unknown path seen in the parent-goal failure.
            //
            // TaskService is the only caller that delegates persistence to BatchWrapper. Its
            // structured envelope makes that ownership explicit and cannot lose the project path.
            if (!feedData?.feedObject || !feedData.projectId || !feedData.objectType) continue

            const feedObjectRef = this.#db.doc(
                `feedsObjectsLastStates/${feedData.projectId}/${feedData.objectType}/${objectId}`
            )
            this.set(feedObjectRef, feedData.feedObject, { merge: true })
        }
    }
}

module.exports = {
    BatchWrapper,
}
