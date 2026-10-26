'use strict'

// A small in-memory Firestore for the linked-uploads index: documents by path, collection queries
// with where/orderBy/startAfter/limit/select, getAll, batches and transactions. It counts the
// documents each collection QUERY returned, so a test can prove what a scan did not read.
const DOCUMENT_ID = { documentId: true }

function createMemoryFirestore(initial = {}) {
    const store = new Map(Object.entries(initial))
    const reads = []
    const parentOf = path => path.slice(0, path.lastIndexOf('/'))
    const idOf = path => path.slice(path.lastIndexOf('/') + 1)
    const snapshotOf = path => {
        const data = store.get(path)
        return {
            id: idOf(path),
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : { ...data }),
        }
    }
    const project = (data, fields) =>
        fields ? Object.fromEntries(fields.filter(field => field in data).map(field => [field, data[field]])) : data

    const doc = path => ({
        path,
        id: idOf(path),
        async get() {
            reads.push(`get:${parentOf(path)}`)
            return snapshotOf(path)
        },
        async set(data, options = {}) {
            store.set(path, options.merge ? { ...(store.get(path) || {}), ...data } : { ...data })
        },
    })

    const query = (path, spec = { filters: [], order: null, after: undefined, limit: Infinity, fields: null }) => ({
        where: (field, op, value) => query(path, { ...spec, filters: [...spec.filters, { field, op, value }] }),
        orderBy: field => query(path, { ...spec, order: field }),
        startAfter: value => query(path, { ...spec, after: value }),
        limit: count => query(path, { ...spec, limit: count }),
        select: (...fields) => query(path, { ...spec, fields }),
        async get() {
            let docs = [...store.keys()]
                .filter(key => parentOf(key) === path)
                .map(key => ({ key, id: idOf(key), data: store.get(key) }))
            for (const { field, op, value } of spec.filters) {
                docs = docs.filter(doc => {
                    const actual = doc.data[field]
                    if (actual === undefined) return false
                    if (op === '>') return actual > value
                    if (op === '>=') return actual >= value
                    if (op === '==') return actual === value
                    throw new Error(`Unsupported operator ${op}`)
                })
            }
            const sortKey = doc => (spec.order === DOCUMENT_ID || !spec.order ? doc.id : doc.data[spec.order])
            docs.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
            if (spec.after !== undefined) docs = docs.filter(doc => sortKey(doc) > spec.after)
            docs = docs.slice(0, spec.limit)
            docs.forEach(() => reads.push(path))
            return {
                docs: docs.map(doc => ({ id: doc.id, data: () => project({ ...doc.data }, spec.fields) })),
            }
        },
    })

    const db = {
        store,
        reads,
        readsOf: path => reads.filter(read => read === path).length,
        doc,
        collection: path => query(path),
        async getAll(...args) {
            const refs = args.filter(arg => arg && arg.path)
            const options = args.find(arg => arg && arg.fieldMask) || {}
            return refs.map(ref => {
                reads.push(`getAll:${parentOf(ref.path)}`)
                const snapshot = snapshotOf(ref.path)
                return {
                    ...snapshot,
                    data: () => (snapshot.exists ? project(snapshot.data(), options.fieldMask) : undefined),
                }
            })
        },
        batch() {
            const ops = []
            let committed = false
            return {
                set(ref, data) {
                    if (committed) throw new Error('Cannot modify a committed batch')
                    ops.push(() => store.set(ref.path, { ...data }))
                },
                delete(ref) {
                    if (committed) throw new Error('Cannot modify a committed batch')
                    ops.push(() => store.delete(ref.path))
                },
                async commit() {
                    committed = true
                    ops.forEach(op => op())
                },
            }
        },
        async runTransaction(fn) {
            return fn({
                get: async ref => snapshotOf(ref.path),
                set: (ref, data, options = {}) =>
                    store.set(ref.path, options.merge ? { ...(store.get(ref.path) || {}), ...data } : { ...data }),
            })
        },
    }
    return db
}

module.exports = { createMemoryFirestore, DOCUMENT_ID }
