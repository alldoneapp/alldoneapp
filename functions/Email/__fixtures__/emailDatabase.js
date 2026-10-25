'use strict'

// Optimistic transactions rerun on conflicting commits. Reads see a stable
// snapshot; failed attempts do not leak writes (including comments/counters).
function createEmailDatabase(initial = {}) {
    const docs = new Map(Object.entries(initial))
    let revision = 0
    const read = (ref, source = docs) => {
        if (!ref.query) return { exists: source.has(ref.path), data: () => source.get(ref.path) }
        const matches = [...source.entries()]
            .filter(
                ([path, data]) =>
                    path.startsWith(`${ref.path}/`) &&
                    path.split('/').length === ref.path.split('/').length + 1 &&
                    ref.field.split('.').reduce((value, key) => value?.[key], data) === ref.value
            )
            .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }))
        return { docs: matches, forEach: callback => matches.forEach(callback) }
    }
    const db = {
        docs,
        doc: path => ({ path, get: async () => read({ path }) }),
        collection: path => ({
            doc: id => db.doc(`${path}/${id}`),
            where: (field, op, value) => {
                const ref = { path, field, value, query: true }
                return { ...ref, get: async () => read(ref) }
            },
        }),
        runTransaction: async callback => {
            for (let attempt = 0; attempt < 20; attempt++) {
                const version = revision
                const source = new Map(docs)
                const writes = []
                let writing = false
                const result = await callback({
                    get: async ref => {
                        if (writing) throw new Error('Firestore reads must precede writes')
                        return read(ref, source)
                    },
                    set: (ref, data, options) => {
                        writing = true
                        writes.push([ref.path, data, options?.merge])
                    },
                    update: (ref, data) => {
                        writing = true
                        writes.push([ref.path, data, true])
                    },
                })
                if (revision !== version) continue
                writes.forEach(([path, data, merge]) => docs.set(path, merge ? { ...docs.get(path), ...data } : data))
                revision++
                return result
            }
            throw new Error('Too many transaction retries')
        },
    }
    return db
}

module.exports = { createEmailDatabase }
