import moment from 'moment'

const PREFIX = 'alldone.newDayRecovery.v1:'
const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage)

// One key per account/project/day avoids replacing another tab's unrelated
// drafts. Keep an in-memory fallback when browser storage is unavailable; the
// reload coordinator must then wait for the actual server acknowledgement.
export const createNewDayRecoveryStore = (getStorage = defaultStorage) => {
    const memory = new Map()
    const volatile = new Set()
    const writes = new Map()
    let sequence = 0
    const keyFor = (userId, kind, projectId = '', date = 0) =>
        `${PREFIX}${encodeURIComponent(userId)}:${kind}:${encodeURIComponent(projectId)}:${date ? moment(date).format('YYYYMMDD') : ''}`
    const read = key => {
        if (volatile.has(key)) return memory.get(key)
        try {
            const storage = getStorage()
            const raw = storage?.getItem(key)
            if (raw) {
                const entry = JSON.parse(raw)
                if (entry && entry.key === key && entry.userId && entry.revision) return entry
            }
            if (storage) {
                memory.delete(key)
                return undefined
            }
        } catch (_) {}
        return memory.get(key)
    }
    const save = entry => {
        memory.set(entry.key, entry)
        volatile.add(entry.key)
        try {
            const storage = getStorage()
            if (storage) {
                storage.setItem(entry.key, JSON.stringify(entry))
                volatile.delete(entry.key)
            }
        } catch (_) {}
        return entry
    }
    const remove = entry => {
        if (read(entry.key)?.revision !== entry.revision) return
        // A confirmed tombstone also survives a failed removeItem. An old draft
        // must not come back from disk after its server write was confirmed.
        save({ ...entry, pending: false })
        try {
            getStorage()?.removeItem(entry.key)
            memory.delete(entry.key)
            volatile.delete(entry.key)
        } catch (_) {}
    }
    const list = userId => {
        const keys = new Set(memory.keys())
        try {
            const storage = getStorage()
            for (let i = 0; storage && i < storage.length; i++) {
                const key = storage.key(i)
                if (key?.startsWith(PREFIX)) keys.add(key)
            }
        } catch (_) {}
        return [...keys].map(read).filter(entry => entry?.userId === userId)
    }
    const queue = values => {
        const previous = read(values.key)
        if (
            previous?.pending &&
            previous?.date === values.date &&
            previous?.rating === values.rating &&
            previous?.comment === values.comment &&
            previous?.previousDate === values.previousDate
        )
            return previous
        return save({
            ...values,
            pending: true,
            revision: `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`,
        })
    }
    // Serialise each day's writes and only clear the revision the server really
    // accepted. A later comment/rating stays recoverable while an older save runs.
    const flush = (entry, write, isActive = () => true) => {
        const previous = writes.get(entry.key)
        const run = async () => {
            const current = read(entry.key)
            if (!current?.pending || !isActive()) return
            await write(current)
            if (read(entry.key)?.revision !== current.revision) return
            if (current.kind === 'ack') save({ ...current, pending: false })
            else remove(current)
        }
        const operation = previous ? previous.catch(() => {}).then(run) : run()
        writes.set(entry.key, operation)
        operation
            .finally(() => {
                if (writes.get(entry.key) === operation) writes.delete(entry.key)
            })
            .catch(() => {})
        return operation
    }
    return {
        list,
        flush,
        hasUnsafeEntries: () => [...volatile].some(key => read(key)?.pending),
        getAcknowledgement: userId => read(keyFor(userId, 'ack')),
        getAcknowledgedDate: (userId, serverDate) =>
            Math.max(Number(serverDate) || 0, Number(read(keyFor(userId, 'ack'))?.date) || 0),
        acknowledge: (userId, previousDate, date) => {
            const key = keyFor(userId, 'ack')
            const previous = read(key)
            if (previous?.date >= date) return previous
            return queue({ key, userId, kind: 'ack', previousDate, date })
        },
        getDraft: (userId, projectId, date) => read(keyFor(userId, 'draft', projectId, date)),
        saveDraft: (userId, projectId, date, rating, comment = '') =>
            queue({
                key: keyFor(userId, 'draft', projectId, date),
                userId,
                kind: 'draft',
                projectId,
                date,
                rating,
                comment,
            }),
    }
}

export const newDayRecoveryStore = createNewDayRecoveryStore()
