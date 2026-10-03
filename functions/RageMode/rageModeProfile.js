const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

const { RAGE_DEFAULT_WEAPON, RAGE_WEAPON_PRICES } = require('./rageWeaponsCatalog')
const { normalizeProgress, sanitizeCheckpoint } = require('./rageModeProgress')
const { boardRef, leaderboardUpdate } = require('./rageModeLeaderboard')

/**
 * A user's rage-mode profile: the weapons they own, their highscore, and how far they got in the
 * raid (`progress`, see rageModeProgress.js) so it follows them from device to device.
 *
 * It lives in `rageModeProfiles/{userId}`, a collection with NO client rule at all — Firestore's
 * default deny means only the Admin SDK can read or write it, so neither ownership nor the
 * highscore can be written from a browser. Everything goes through these three callables. That is
 * deliberately not `users/{uid}` or `users/{uid}/private/**`: both are owner-writable, and owning a
 * weapon is something the user paid Gold for.
 *
 * Buying is charged through `deductGold` with source `rage_mode_item` and an idempotency key that is
 * unique per user AND weapon, so a double click, a retried request or a failure between the charge
 * and the ownership write can never charge twice: the retry finds the claim, skips the charge and
 * finishes the write.
 */

const COLLECTION = 'rageModeProfiles'
// A generous ceiling for one game. Scores are for fun and not verified, but a garbage number must not
// become somebody's highscore forever.
const MAX_SCORE = 10000000

const profileRef = userId => admin.firestore().doc(`${COLLECTION}/${userId}`)

const normalizeProfile = (data = {}) => {
    const stored = Array.isArray(data.owned) ? data.owned : []
    const owned = [
        RAGE_DEFAULT_WEAPON,
        ...stored.filter(
            (id, index) =>
                id !== RAGE_DEFAULT_WEAPON &&
                Object.prototype.hasOwnProperty.call(RAGE_WEAPON_PRICES, id) &&
                stored.indexOf(id) === index
        ),
    ]
    const highscore = Number(data.highscore)
    return {
        owned,
        highscore: Number.isFinite(highscore) && highscore > 0 ? Math.floor(highscore) : 0,
        games: Number.isFinite(Number(data.games)) ? Math.max(0, Math.floor(Number(data.games))) : 0,
        progress: normalizeProgress(data.progress),
    }
}

const getRageModeProfile = async ({ userId }) => {
    const snapshot = await profileRef(userId).get()
    return normalizeProfile(snapshot.exists ? snapshot.data() : {})
}

const purchaseRageModeItem = async ({ userId, itemId }) => {
    if (typeof itemId !== 'string' || !Object.prototype.hasOwnProperty.call(RAGE_WEAPON_PRICES, itemId)) {
        return { ok: false, reason: 'unknown_item' }
    }
    const price = RAGE_WEAPON_PRICES[itemId]
    const ref = profileRef(userId)
    const snapshot = await ref.get()
    const profile = normalizeProfile(snapshot.exists ? snapshot.data() : {})
    if (profile.owned.includes(itemId)) return { ok: true, alreadyOwned: true, ...profile }

    // Lazy require: goldHelper pulls in mail and analytics clients the profile read never needs.
    const { deductGold } = require('../Gold/goldHelper')
    const charge = await deductGold(userId, price, {
        source: 'rage_mode_item',
        note: itemId,
        idempotencyKey: `rage_mode_item:${itemId}`,
    })
    if (!charge || !charge.success) {
        const insufficient = charge && charge.message === 'Insufficient gold'
        return {
            ok: false,
            reason: insufficient ? 'insufficient_gold' : 'charge_failed',
            currentGold: charge && charge.currentGold,
        }
    }

    await ref.set(
        {
            owned: FieldValue.arrayUnion(itemId),
            updatedAt: Date.now(),
        },
        { merge: true }
    )
    return {
        ok: true,
        ...profile,
        owned: [...profile.owned, itemId],
        newBalance: charge.newBalance,
        alreadyCharged: !!charge.alreadyProcessed,
    }
}

/**
 * Record a score. The best one is kept on the profile AND on the global leaderboard, in one
 * transaction. `final: false` is a score posted mid-run (after a mission, to show the board in the
 * hangar): it can set a new best, but it does not count as a finished game.
 */
const submitRageModeScore = async ({ userId, score, final = true }) => {
    // Only a real number counts: `Number(null)` is 0, which would quietly log a game with no score.
    const value = typeof score === 'number' ? score : NaN
    if (!Number.isFinite(value) || value < 0 || value > MAX_SCORE) {
        return { ok: false, reason: 'invalid_score' }
    }
    const points = Math.floor(value)
    const ref = profileRef(userId)
    let result = null
    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const entry = await transaction.get(boardRef(userId))
        const data = snapshot.exists ? snapshot.data() : {}
        const profile = normalizeProfile(data)
        const isNew = points > profile.highscore
        const update = { lastScore: points, updatedAt: Date.now() }
        if (final !== false) update.games = profile.games + 1
        if (isNew) {
            update.highscore = points
            update.highscoreAt = Date.now()
        }
        transaction.set(ref, update, { merge: true })
        // The board holds the best score — also one set before the board existed.
        const best = isNew ? points : profile.highscore
        const onBoard = entry.exists ? Number((entry.data() || {}).score) || 0 : 0
        if (best > onBoard)
            transaction.set(boardRef(userId), leaderboardUpdate(userId, best, data.name), { merge: true })
        result = { ok: true, isNew, highscore: isNew ? points : profile.highscore, previous: profile.highscore }
    })
    return result
}

/**
 * Save the raid's progress: a checkpoint after a completed mission (or a hangar purchase), or `null`
 * for "start over". The SERVER stamps `savedAt`, so devices with different clocks still agree on
 * which save is the newest; the client keeps that stamp with its own copy.
 */
const saveRageModeProgress = async ({ userId, checkpoint }) => {
    const sanitized = checkpoint === null ? null : sanitizeCheckpoint(checkpoint)
    if (checkpoint !== null && !sanitized) return { ok: false, reason: 'invalid_progress' }
    const savedAt = Date.now()
    await profileRef(userId).set({ progress: { checkpoint: sanitized, savedAt }, updatedAt: savedAt }, { merge: true })
    return { ok: true, savedAt, checkpoint: sanitized }
}

module.exports = {
    COLLECTION,
    MAX_SCORE,
    getRageModeProfile,
    normalizeProfile,
    purchaseRageModeItem,
    saveRageModeProgress,
    submitRageModeScore,
}
