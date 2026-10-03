const admin = require('firebase-admin')
const crypto = require('crypto')

/**
 * The rage-mode raid's GLOBAL leaderboard: every player's best score under a name they choose.
 *
 * It lives in `rageModeLeaderboard/{userId}` — a collection with no client rule, so (like
 * `rageModeProfiles`) only these Cloud Functions can read or write it. One document per player,
 * holding their best score only; the score is written by `submitRageModeScore` in the same
 * transaction that keeps the highscore, so the two can never disagree.
 *
 * NAMES. The board is shown to every Alldone user across every workspace, so a player's real name
 * must never appear on it by default: until they pick one, an entry is shown as "Pilot ####", a
 * number derived from the user id (stable, but meaningless). A chosen name is 2–20 letters, digits,
 * spaces or . _ - ' — enough to be recognisable, nothing that can carry a link, markup or a mention.
 *
 * RANK is "how many have a strictly higher best score, plus one", answered with a count aggregate,
 * so equal scores share a rank and nothing has to read the whole board.
 */

const COLLECTION = 'rageModeLeaderboard'
const TOP = 5
const NAME_MIN = 2
const NAME_MAX = 20

const boardRef = userId => admin.firestore().doc(`${COLLECTION}/${userId}`)

const defaultName = userId => {
    const hash = crypto
        .createHash('sha256')
        .update(String(userId || ''))
        .digest()
    return `Pilot ${1000 + (hash.readUInt16BE(0) % 9000)}`
}

/** A name fit for a public board, or null. */
const sanitizeName = raw => {
    if (typeof raw !== 'string') return null
    const name = raw
        .normalize('NFC')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    const length = Array.from(name).length
    if (length < NAME_MIN || length > NAME_MAX) return null
    if (!/^[\p{L}\p{N} ._'-]+$/u.test(name)) return null
    if (!/[\p{L}\p{N}]/u.test(name)) return null
    return name
}

const entryOf = (snapshot, userId) => {
    const data = snapshot.data() || {}
    const score = Number(data.score)
    return {
        userId: snapshot.id,
        name: sanitizeName(data.name) || defaultName(snapshot.id),
        score: Number.isFinite(score) ? Math.floor(score) : 0,
        you: snapshot.id === userId,
    }
}

/** The leaderboard entry write for a new best score (used inside the score transaction). */
const leaderboardUpdate = (userId, score, name) => ({
    score,
    name: sanitizeName(name) || defaultName(userId),
    updatedAt: Date.now(),
})

/**
 * The top five, and where the caller stands: `{ top: [{rank, name, score, you}], you: {rank, name,
 * score} | null, total }`. `you` is null until the caller has a score on the board.
 */
const getRageModeLeaderboard = async ({ userId }) => {
    const board = admin.firestore().collection(COLLECTION)
    const [topSnapshot, ownSnapshot, totalSnapshot] = await Promise.all([
        board.orderBy('score', 'desc').limit(TOP).get(),
        boardRef(userId).get(),
        board.where('score', '>', 0).count().get(),
    ])
    const top = []
    let previousScore = null
    let previousRank = 0
    topSnapshot.docs.forEach((doc, index) => {
        const entry = entryOf(doc, userId)
        // Equal scores share a rank.
        const rank = entry.score === previousScore ? previousRank : index + 1
        previousScore = entry.score
        previousRank = rank
        top.push({ rank, name: entry.name, score: entry.score, you: entry.you })
    })
    let you = null
    const own = ownSnapshot.exists ? entryOf(ownSnapshot, userId) : null
    if (own && own.score > 0) {
        const higher = await board.where('score', '>', own.score).count().get()
        you = { rank: higher.data().count + 1, name: own.name, score: own.score }
    }
    const profile = await admin.firestore().doc(`rageModeProfiles/${userId}`).get()
    const chosen = profile.exists ? sanitizeName((profile.data() || {}).name) : null
    return {
        top,
        you,
        total: totalSnapshot.data().count,
        name: chosen || defaultName(userId),
        nameChosen: !!chosen,
    }
}

/** Choose the name shown on the board. Returns `{ ok, name }` or `{ ok: false, reason }`. */
const setRageModeName = async ({ userId, name }) => {
    const clean = sanitizeName(name)
    if (!clean) return { ok: false, reason: 'invalid_name' }
    const now = Date.now()
    await admin.firestore().doc(`rageModeProfiles/${userId}`).set({ name: clean, updatedAt: now }, { merge: true })
    const entry = await boardRef(userId).get()
    if (entry.exists) await boardRef(userId).set({ name: clean, updatedAt: now }, { merge: true })
    return { ok: true, name: clean }
}

module.exports = {
    COLLECTION,
    TOP,
    boardRef,
    defaultName,
    getRageModeLeaderboard,
    leaderboardUpdate,
    sanitizeName,
    setRageModeName,
}
