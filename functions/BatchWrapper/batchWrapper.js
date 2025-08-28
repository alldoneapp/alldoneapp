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
    }

    initBatch() {
        this.#counter = 0
        this.#batch = this.#db.batch()
        this.#batchs.push(this.#batch)
    }

    update(ref, object) {
        if (this.#batchs.length === 0) this.initBatch()

        if (this.#counter < this.#actionsLimit) {
            this.#batch.update(ref, object)
            this.#counter++
        } else {
            this.initBatch()
            this.update(ref, object)
        }
    }

    set(ref, object, params) {
        if (this.#batchs.length === 0) this.initBatch()

        if (this.#counter < this.#actionsLimit) {
            this.#batch.set(ref, object, params)
            this.#counter++
        } else {
            this.initBatch()
            this.set(ref, object, params)
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
        await this.#persistFeedObjects()

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
    }

    async #persistFeedObjects() {
        // Persist feed objects to Firestore if any exist
        if (Object.keys(this.feedObjects).length > 0) {
            for (const [objectId, feedContext] of Object.entries(this.feedObjects)) {
                try {
                    if (feedContext.feedObject && feedContext.projectId && feedContext.objectType) {
                        // Write feed object to feedsObjectsLastStates collection
                        const feedObjectRef = this.#db.doc(
                            `feedsObjectsLastStates/${feedContext.projectId}/${feedContext.objectType}/${objectId}`
                        )

                        // Use the existing batch system to add the feed object write
                        this.set(feedObjectRef, feedContext.feedObject, { merge: true })
                    } else {
                        console.warn('BatchWrapper: Invalid feed context for objectId:', objectId, feedContext)
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
