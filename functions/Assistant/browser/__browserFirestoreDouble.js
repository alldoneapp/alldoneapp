'use strict'

// A small in-memory Firestore double for the browser suites.
//
// It exists because the properties under test are ORDERING properties — the budget is charged in
// the same transaction that hands out the step, a `once` grant is consumed exactly once, an audit
// record is written for a step that was refused — and a mock that records calls cannot express any
// of them. This one implements enough of the real semantics (documents, merge writes, transactions
// with reads before writes, a `where`/`limit` query) that a test failure means the code is wrong.

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function mergeInto(target, patch) {
    const output = { ...(target || {}) }
    for (const [key, value] of Object.entries(patch || {})) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            output[key] &&
            typeof output[key] === 'object' &&
            !Array.isArray(output[key])
        ) {
            output[key] = mergeInto(output[key], value)
        } else {
            output[key] = value
        }
    }
    return output
}

function snapshotFor(path, data) {
    return {
        id: path.split('/').pop(),
        ref: { path },
        exists: data !== undefined,
        data: () => clone(data),
    }
}

class FirestoreDouble {
    constructor(initialDocuments = {}) {
        this.documents = new Map(Object.entries(initialDocuments).map(([path, data]) => [path, clone(data)]))
        this.writes = []
        this.transactionAttempts = 0
    }

    doc(path) {
        const store = this
        return {
            path,
            async get() {
                return snapshotFor(path, store.documents.get(path))
            },
            async set(data, options = {}) {
                store.writeDoc(path, data, options)
                return true
            },
            async update(data) {
                store.writeDoc(path, data, { merge: true })
                return true
            },
            async delete() {
                store.documents.delete(path)
            },
        }
    }

    collection(path) {
        return new QueryDouble(this, path, [])
    }

    writeDoc(path, data, options = {}) {
        const next = options.merge ? mergeInto(this.documents.get(path), clone(data)) : clone(data)
        this.documents.set(path, next)
        this.writes.push({ path, data: clone(data), merge: options.merge === true })
    }

    async runTransaction(handler) {
        this.transactionAttempts += 1
        const pending = []
        const transaction = {
            get: async ref => this.doc(ref.path || ref).get(),
            set: (ref, data, options = {}) => pending.push({ path: ref.path || ref, data, options }),
            update: (ref, data) => pending.push({ path: ref.path || ref, data, options: { merge: true } }),
            delete: ref => pending.push({ path: ref.path || ref, delete: true }),
        }
        const result = await handler(transaction)
        for (const write of pending) {
            if (write.delete) this.documents.delete(write.path)
            else this.writeDoc(write.path, write.data, write.options)
        }
        return result
    }

    /** Every document under a collection path, for assertions about the audit trail. */
    listCollection(collectionPath) {
        const prefix = `${collectionPath}/`
        return [...this.documents.entries()]
            .filter(([path]) => path.startsWith(prefix) && path.slice(prefix.length).split('/').length === 1)
            .map(([path, data]) => ({ path, ...clone(data) }))
    }

    listSubcollection(collectionPath) {
        return [...this.documents.entries()]
            .filter(([path]) => path.startsWith(`${collectionPath}/`))
            .map(([path, data]) => ({ path, ...clone(data) }))
    }
}

class QueryDouble {
    constructor(store, collectionPath, filters, limitValue = null) {
        this.store = store
        this.collectionPath = collectionPath
        this.filters = filters
        this.limitValue = limitValue
    }

    where(field, operator, value) {
        if (operator !== '==') throw new Error(`FirestoreDouble supports only == filters, got ${operator}`)
        return new QueryDouble(this.store, this.collectionPath, [...this.filters, { field, value }], this.limitValue)
    }

    limit(count) {
        return new QueryDouble(this.store, this.collectionPath, this.filters, count)
    }

    async get() {
        const prefix = `${this.collectionPath}/`
        const matches = [...this.store.documents.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, data]) => this.filters.every(filter => data && data[filter.field] === filter.value))
            .slice(0, this.limitValue === null ? undefined : this.limitValue)
        return {
            size: matches.length,
            empty: matches.length === 0,
            docs: matches.map(([path, data]) => snapshotFor(path, data)),
            forEach(callback) {
                matches.forEach(([path, data]) => callback(snapshotFor(path, data)))
            },
        }
    }
}

/** A storage bucket double that records what evidence would have been uploaded. */
function createBucketDouble(name = 'alldone-test.appspot.com') {
    const files = new Map()
    return {
        name,
        files,
        file(path) {
            return {
                async save(buffer, options) {
                    files.set(path, { bytes: buffer.length, contentType: options?.contentType, buffer })
                },
            }
        },
    }
}

module.exports = { FirestoreDouble, createBucketDouble }
