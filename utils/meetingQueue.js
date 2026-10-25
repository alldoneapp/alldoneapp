// Resolve writes only after transaction completion (a request's onsuccess is NOT durable).
export function openMeetingQueue() {
    return new Promise((resolve, reject) => {
        let blocked = false
        const request = indexedDB.open('alldone-microphone-meetings', 1)
        request.onupgradeneeded = () => {
            request.result.createObjectStore('chunks', { keyPath: 'id' }).createIndex('owner', 'owner')
        }
        request.onerror = () => reject(request.error)
        request.onblocked = () => {
            blocked = true
            reject(new Error('storage-blocked'))
        }
        request.onsuccess = () => {
            const db = request.result
            if (blocked) {
                db.close()
                return
            }
            db.onversionchange = () => db.close()
            const run = (mode, action) =>
                new Promise((done, fail) => {
                    const transaction = db.transaction(
                        'chunks',
                        mode,
                        mode === 'readwrite' ? { durability: 'strict' } : undefined
                    )
                    const result = action(transaction.objectStore('chunks'))
                    transaction.oncomplete = () => done(result.result)
                    transaction.onabort = transaction.onerror = () => fail(transaction.error || new Error('storage'))
                })
            resolve({
                enqueue: chunk =>
                    run('readwrite', store => {
                        const existing = store.get(chunk.id)
                        existing.onsuccess = () => {
                            if (!existing.result) store.add(chunk)
                        }
                        return existing
                    }),
                put: chunk => run('readwrite', store => store.put(chunk)),
                remove: id => run('readwrite', store => store.delete(id)),
                list: owner => run('readonly', store => store.index('owner').getAll(owner)),
                close: () => db.close(),
            })
        }
    })
}

// Shared by live capture and reload recovery. A transcript is durable BEFORE insertion;
// audio is deleted only after the note (including its chunk marker) reached canonical Storage.
export async function drainMeetingQueue({ queue, owner, transcribe, persist, isActive = () => true, onPending }) {
    const chunks = (await queue.list(owner)).sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence)
    let pending = chunks.length
    onPending?.(pending)
    for (const chunk of chunks) {
        if (!isActive()) return
        if (chunk.text === undefined) {
            chunk.text = await transcribe(chunk)
            if (typeof chunk.text !== 'string') throw new Error('invalid-transcript')
            await queue.put(chunk)
        }
        if (!isActive()) return
        if (!(await persist(chunk))) throw new Error('note-pending')
        await queue.remove(chunk.id)
        onPending?.(--pending)
    }
}
