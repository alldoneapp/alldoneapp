'use strict'

// A small in-memory Firestore for unit tests of server services that take `db` as a parameter:
// doc/collection reads and writes, equality and range `where` filters, dotted-path updates,
// deletes, batches and auto ids. Not a test file itself (no `.test.js`), shared by suites.

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
        get: async () => snapshotOf(path),
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

    const query = (path, filters = []) => ({
        where: (field, op, value) => query(path, [...filters, { field, op, value }]),
        get: async () => {
            const prefix = `${path}/`
            const matching = [...docs.keys()].filter(key => {
                if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) return false
                const data = docs.get(key)
                return filters.every(filter => compare(data[filter.field], filter.op, filter.value))
            })
            return { size: matching.length, empty: matching.length === 0, docs: matching.map(snapshotOf) }
        },
    })

    const db = {
        docs,
        writes,
        doc: docRef,
        collection: path => ({
            ...query(path),
            doc: id => docRef(`${path}/${id || `auto${++autoId}`}`),
        }),
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
