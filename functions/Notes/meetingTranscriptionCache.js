const crypto = require('crypto')
const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

// Server-only collection (default-denied by Firestore rules). A lease prevents concurrent
// provider calls; a content hash refuses reuse of a chunk ID with different audio.
exports.withMeetingTranscriptionCache = async ({ uid, sessionId, chunkIndex, audioChunk, run }) => {
    if (
        typeof sessionId !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(sessionId) ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex > 10000
    ) {
        throw new HttpsError('invalid-argument', 'Invalid meeting chunk ID')
    }
    const key = crypto.createHash('sha256').update(`${uid}:${sessionId}:${chunkIndex}`).digest('hex')
    const hash = crypto.createHash('sha256').update(audioChunk).digest('hex')
    const ref = admin.firestore().doc(`meetingTranscriptionResults/${key}`)
    const lease = crypto.randomUUID()
    const cached = await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const value = snapshot.data()
        if (value?.hash && value.hash !== hash)
            throw new HttpsError('invalid-argument', 'Meeting chunk ID already used')
        if (typeof value?.text === 'string') return { text: value.text }
        if (value?.leaseUntil > Date.now()) throw new HttpsError('aborted', 'Meeting chunk is processing; retry later')
        transaction.set(
            ref,
            { uid, hash, lease, leaseUntil: Date.now() + 330000, createdAt: Date.now() },
            { merge: true }
        )
        return null
    })
    if (cached) return cached
    try {
        const result = await run(`meeting_transcription:${key}`)
        await admin.firestore().runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            if (snapshot.data()?.lease !== lease) throw new HttpsError('aborted', 'Meeting chunk lease changed')
            transaction.set(ref, { text: result.text, leaseUntil: 0 }, { merge: true })
        })
        return result
    } catch (error) {
        await admin
            .firestore()
            .runTransaction(async transaction => {
                const snapshot = await transaction.get(ref)
                if (snapshot.data()?.lease === lease) transaction.set(ref, { leaseUntil: 0 }, { merge: true })
            })
            .catch(() => {})
        throw error
    }
}
