'use strict'

/**
 * Minimal in-memory Firestore for the 2026-11 security regression suites. Supports exactly what
 * the code under test touches: doc(path).get/set/update, collection(name).doc(id) and getAll.
 */
function createFirestoreDouble(seed = {}) {
    const store = new Map(Object.entries(seed).map(([path, data]) => [path, { ...data }]))
    const writes = []

    const snapshot = path => {
        const data = store.get(path)
        return { exists: data !== undefined, id: path.split('/').pop(), data: () => (data ? { ...data } : undefined) }
    }

    const docRef = path => ({
        path,
        get: async () => snapshot(path),
        set: async (data, options) => {
            writes.push({ op: 'set', path, data })
            store.set(path, options && options.merge ? { ...(store.get(path) || {}), ...data } : { ...data })
        },
        update: async data => {
            writes.push({ op: 'update', path, data })
            store.set(path, { ...(store.get(path) || {}), ...data })
        },
    })

    return {
        store,
        writes,
        doc: docRef,
        collection: name => ({ doc: id => docRef(`${name}/${id}`) }),
        getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
    }
}

module.exports = { createFirestoreDouble }
