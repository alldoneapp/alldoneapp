'use strict'

// A small in-memory Firestore double for the project wiki suites.
//
// The behaviour under test is query-shaped — which documents a delta query returns, in which
// order, where a page boundary falls, that a document missing the ordered field is not returned at
// all — so it implements those semantics instead of recording calls: range and equality filters,
// array-contains, orderBy in both directions, limit, transactions, batches and the three
// FieldValue sentinels the wiki code writes (passed in as `fieldValue`, see below).

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const fieldValue = {
    arrayUnion: (...values) => ({ __fieldValue: 'arrayUnion', values }),
    arrayRemove: (...values) => ({ __fieldValue: 'arrayRemove', values }),
    delete: () => ({ __fieldValue: 'delete' }),
}

function applyPatch(existing, patch) {
    const output = { ...(existing || {}) }
    for (const [key, value] of Object.entries(patch || {})) {
        if (value && value.__fieldValue === 'delete') {
            delete output[key]
        } else if (value && value.__fieldValue === 'arrayUnion') {
            const current = Array.isArray(output[key]) ? output[key] : []
            output[key] = [...current, ...value.values.filter(item => !current.includes(item))]
        } else if (value && value.__fieldValue === 'arrayRemove') {
            const current = Array.isArray(output[key]) ? output[key] : []
            output[key] = current.filter(item => !value.values.includes(item))
        } else {
            output[key] = clone(value)
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

function compareValues(left, right) {
    if (left === right) return 0
    return left < right ? -1 : 1
}

// Range filters only match values of the filter's own type, as in Firestore (where a null or a
// missing field never satisfies `>= 0`, while JavaScript's `null >= 0` is true).
const sameType = (value, target) => value !== null && value !== undefined && typeof value === typeof target

const OPERATORS = {
    '==': (value, target) => value === target,
    '>': (value, target) => sameType(value, target) && value > target,
    '>=': (value, target) => sameType(value, target) && value >= target,
    '<': (value, target) => sameType(value, target) && value < target,
    '<=': (value, target) => sameType(value, target) && value <= target,
    'array-contains': (value, target) => Array.isArray(value) && value.includes(target),
}

class KnowledgeFirestoreDouble {
    constructor(initialDocuments = {}) {
        this.documents = new Map(Object.entries(initialDocuments).map(([path, data]) => [path, clone(data)]))
        this.queries = []
        this.commits = 0
    }

    doc(path) {
        const store = this
        return {
            id: path.split('/').pop(),
            path,
            async get() {
                return snapshotFor(path, store.documents.get(path))
            },
            async set(data, options = {}) {
                store.write(path, data, options)
            },
            async update(data) {
                store.update(path, data)
            },
            async delete() {
                store.documents.delete(path)
            },
        }
    }

    collection(path) {
        return new KnowledgeQueryDouble(this, path)
    }

    write(path, data, options = {}) {
        const base = options.merge ? this.documents.get(path) : undefined
        this.documents.set(path, applyPatch(base, data))
    }

    update(path, data) {
        if (!this.documents.has(path)) {
            const error = new Error(`No document to update: ${path}`)
            error.code = 5
            throw error
        }
        this.documents.set(path, applyPatch(this.documents.get(path), data))
    }

    async getAll(...refs) {
        return refs.map(ref => snapshotFor(ref.path, this.documents.get(ref.path)))
    }

    batch() {
        const operations = []
        const store = this
        return {
            set(ref, data, options = {}) {
                operations.push(() => store.write(ref.path, data, options))
            },
            update(ref, data) {
                operations.push(() => store.update(ref.path, data))
            },
            delete(ref) {
                operations.push(() => store.documents.delete(ref.path))
            },
            async commit() {
                operations.forEach(operation => operation())
                store.commits += 1
            },
        }
    }

    async runTransaction(handler) {
        const pending = []
        const transaction = {
            get: async ref => snapshotFor(ref.path, this.documents.get(ref.path)),
            set: (ref, data, options = {}) => pending.push(() => this.write(ref.path, data, options)),
            update: (ref, data) => pending.push(() => this.update(ref.path, data)),
            delete: ref => pending.push(() => this.documents.delete(ref.path)),
        }
        const result = await handler(transaction)
        pending.forEach(operation => operation())
        return result
    }

    read(path) {
        return clone(this.documents.get(path))
    }
}

class KnowledgeQueryDouble {
    constructor(store, collectionPath, filters = [], orders = [], limitValue = null, selectFields = null) {
        this.store = store
        this.collectionPath = collectionPath
        this.filters = filters
        this.orders = orders
        this.limitValue = limitValue
        this.selectFields = selectFields
    }

    with(changes) {
        const next = { ...this, ...changes }
        return new KnowledgeQueryDouble(
            this.store,
            next.collectionPath,
            next.filters,
            next.orders,
            next.limitValue,
            next.selectFields
        )
    }

    where(field, operator, value) {
        if (!OPERATORS[operator]) throw new Error(`KnowledgeFirestoreDouble does not support ${operator}`)
        return this.with({ filters: [...this.filters, { field, operator, value }] })
    }

    orderBy(field, direction = 'asc') {
        return this.with({ orders: [...this.orders, { field, direction }] })
    }

    limit(count) {
        return this.with({ limitValue: count })
    }

    // Like Firestore's field mask: documents come back with the selected fields only, so a suite
    // can tell a reader that needs the index from one that downloads every page body.
    select(...fields) {
        return this.with({ selectFields: fields })
    }

    async get() {
        this.store.queries.push({
            collectionPath: this.collectionPath,
            filters: this.filters,
            orders: this.orders,
            limit: this.limitValue,
            select: this.selectFields,
        })
        const prefix = `${this.collectionPath}/`
        let matches = [...this.store.documents.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .filter(([, data]) =>
                this.filters.every(filter => OPERATORS[filter.operator](data?.[filter.field], filter.value))
            )
            // Like Firestore, ordering by a field drops documents that do not have it.
            .filter(([, data]) =>
                this.orders.every(order => data?.[order.field] !== undefined && data?.[order.field] !== null)
            )

        matches.sort(([leftPath, left], [rightPath, right]) => {
            for (const order of this.orders) {
                const result = compareValues(left[order.field], right[order.field])
                if (result !== 0) return order.direction === 'desc' ? -result : result
            }
            const lastDirection = this.orders.length ? this.orders[this.orders.length - 1].direction : 'asc'
            const byId = compareValues(leftPath, rightPath)
            return lastDirection === 'desc' ? -byId : byId
        })
        if (this.limitValue !== null) matches = matches.slice(0, this.limitValue)

        const project = data =>
            this.selectFields
                ? Object.fromEntries(
                      this.selectFields.filter(field => field in data).map(field => [field, data[field]])
                  )
                : data
        const docs = matches.map(([path, data]) => snapshotFor(path, project(data)))
        return { size: docs.length, empty: docs.length === 0, docs, forEach: callback => docs.forEach(callback) }
    }
}

module.exports = { KnowledgeFirestoreDouble, fieldValue }
