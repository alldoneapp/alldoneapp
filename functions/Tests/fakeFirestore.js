'use strict'

// A small in-memory Firestore for unit tests of server services that take `db` as a parameter:
// doc/collection reads and writes, equality and range `where` filters, `orderBy`/`limit`, dotted-path updates,
// deletes, batches, `getAll` and auto ids. `onSnapshot` delivers the current state once (no live updates),
// so web code that listens can be fed the same data. Not a test file itself (no `.test.js`), shared by suites.

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

function createFakeFirestore(initial = {}) {
    const docs = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]))
    const writes = []
    let autoId = 0

    const applyUpdate = (path, data) => {
        if (!docs.has(path)) throw new Error(`No document to update: ${path}`)
        const target = docs.get(path)
        for (const [key, value] of Object.entries(data)) {
            const parts = key.split('.')
            let node = target
            for (const part of parts.slice(0, -1)) {
                node[part] = node[part] && typeof node[part] === 'object' ? node[part] : {}
                node = node[part]
            }
            node[parts[parts.length - 1]] = clone(value)
        }
    }

    const record = (type, path, data) => writes.push({ type, path, data: clone(data) })

    const snapshotOf = path => {
        const exists = docs.has(path)
        return {
            id: path.split('/').pop(),
            ref: docRef(path),
            exists,
            data: () => (exists ? clone(docs.get(path)) : undefined),
        }
    }

    const docRef = path => ({
        path,
        id: path.split('/').pop(),
        get firestore() {
            return db
        },
        get: async () => snapshotOf(path),
        onSnapshot: (next, error) => deliverOnce(() => snapshotOf(path), next, error),
        set: async (data, options) => {
            record('set', path, data)
            if (options?.merge && docs.has(path)) docs.set(path, { ...docs.get(path), ...clone(data) })
            else docs.set(path, clone(data))
        },
        update: async data => {
            record('update', path, data)
            applyUpdate(path, data)
        },
        delete: async () => {
            record('delete', path)
            docs.delete(path)
        },
    })

    const compare = (value, op, expected) => {
        switch (op) {
            case '==':
                return value === expected
            case '>=':
                return value >= expected
            case '<=':
                return value <= expected
            case '>':
                return value > expected
            case '<':
                return value < expected
            case 'array-contains':
                return Array.isArray(value) && value.includes(expected)
            default:
                throw new Error(`Unsupported operator ${op}`)
        }
    }

    const deliverOnce = (read, next, error) => {
        let active = true
        Promise.resolve()
            .then(read)
            .then(
                snapshot => active && next(snapshot),
                failure => active && error && error(failure)
            )
        return () => {
            active = false
        }
    }

    // `orderBy` keeps only documents that have the field, as Firestore does.
    const query = (path, filters = [], order = null, max = null) => ({
        where: (field, op, value) => query(path, [...filters, { field, op, value }], order, max),
        orderBy: (field, direction = 'asc') => query(path, filters, { field, direction }, max),
        limit: count => query(path, filters, order, count),
        onSnapshot: (next, error) => deliverOnce(() => query(path, filters, order, max).get(), next, error),
        get: async () => {
            const prefix = `${path}/`
            let matching = [...docs.keys()].filter(key => {
                if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) return false
                const data = docs.get(key)
                if (order && data[order.field] === undefined) return false
                return filters.every(filter => compare(data[filter.field], filter.op, filter.value))
            })
            if (order) {
                const sign = order.direction === 'desc' ? -1 : 1
                matching.sort((a, b) => {
                    const left = docs.get(a)[order.field]
                    const right = docs.get(b)[order.field]
                    return left === right ? 0 : left < right ? -sign : sign
                })
            }
            if (max !== null) matching = matching.slice(0, max)
            const snapshots = matching.map(snapshotOf)
            return {
                size: snapshots.length,
                empty: snapshots.length === 0,
                docs: snapshots,
                forEach: callback => snapshots.forEach(callback),
            }
        },
    })

    // Firestore accepts a leading slash ('/statistics/...'); stored keys have none.
    const cleanPath = path => String(path).replace(/^\/+/, '')

    const db = {
        docs,
        writes,
        doc: path => docRef(cleanPath(path)),
        getAll: async (...refs) => refs.map(ref => snapshotOf(ref.path)),
        collection: rawPath => {
            const path = cleanPath(rawPath)
            return {
                ...query(path),
                doc: id => docRef(`${path}/${id || `auto${++autoId}`}`),
            }
        },
        batch: () => {
            const ops = []
            return {
                set: (ref, data, options) => ops.push(() => ref.set(data, options)),
                update: (ref, data) => ops.push(() => ref.update(data)),
                delete: ref => ops.push(() => ref.delete()),
                commit: async () => {
                    for (const op of ops) await op()
                },
            }
        },
        // Reads see the state before the transaction; writes apply together when it returns.
        runTransaction: async fn => {
            const ops = []
            const result = await fn({
                get: async ref => snapshotOf(ref.path),
                set: (ref, data, options) => ops.push(() => ref.set(data, options)),
                update: (ref, data) => ops.push(() => ref.update(data)),
                delete: ref => ops.push(() => ref.delete()),
            })
            for (const op of ops) await op()
            return result
        },
    }
    return db
}

module.exports = { createFakeFirestore }
