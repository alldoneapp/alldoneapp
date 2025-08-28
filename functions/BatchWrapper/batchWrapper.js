class BatchWrapper {
    #batchs = []
    #batch
    #counter = 0
    #actionsLimit
    #db

    constructor(db, actionsLimit = 500) {
        this.#db = db
        this.#actionsLimit = actionsLimit
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
    }
}

module.exports = {
    BatchWrapper,
}
