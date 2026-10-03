import { BASE_MAX_SHIELD, createRun, MAX_BOMBS, MAX_CANNON_LEVEL, SHIELD_CAP } from './raidRun'

/**
 * The raid remembers how far you got, on every device. Clearing a mission saves a checkpoint — the
 * mission you completed plus the run as it leaves the hangar (shield, bombs, upgrades, credits,
 * score) — and the next raid takes off from there, at the following mission. A game over replays
 * from the checkpoint too. Only "Start over" clears it (saved as an EMPTY checkpoint, so the other
 * devices drop theirs as well).
 *
 * Two copies. The server's (`rageModeProfiles/{uid}.progress`, via `saveRageModeProgress`) is what
 * makes it follow you; the browser's (localStorage, one entry per user) makes the next take-off
 * instant and keeps a save that could not reach the server, marked `pending` until it does. Every
 * record carries `savedAt`, stamped by the SERVER once synced, and `reconcile` picks the newer of
 * the two at take-off.
 *
 * Both copies can be edited by their owner, so a checkpoint is always read through
 * `sanitizeCheckpoint` — every number clamped to what the game itself could have produced. Credits
 * only ever buy in-run consumables, so an edited checkpoint cheats nobody but its author; Gold is
 * never involved. The server applies the same rules (`functions/RageMode/rageModeProgress.js`).
 */

export const PROGRESS_KEY_PREFIX = 'alldone.rageMode.progress'
export const MAX_SAVED_MISSION = 999
const MAX_SAVED_NUMBER = 10000000

export const progressKey = scope => `${PROGRESS_KEY_PREFIX}.${scope || 'anonymous'}`

const wholeNumber = (value, min, max, fallback) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.max(min, Math.min(max, Math.floor(number)))
}

/** A checkpoint as it was read from storage, or null if it is missing or not a checkpoint at all. */
export const sanitizeCheckpoint = raw => {
    if (!raw || typeof raw !== 'object') return null
    const completed = wholeNumber(raw.completed, 0, MAX_SAVED_MISSION, 0)
    if (completed < 1) return null
    const maxShield = wholeNumber(raw.maxShield, BASE_MAX_SHIELD, SHIELD_CAP, BASE_MAX_SHIELD)
    return {
        completed,
        score: wholeNumber(raw.score, 0, MAX_SAVED_NUMBER, 0),
        credits: wholeNumber(raw.credits, 0, MAX_SAVED_NUMBER, 0),
        maxShield,
        // A checkpoint never sends you out on an empty shield.
        shield: wholeNumber(raw.shield, 1, maxShield, maxShield),
        bombs: wholeNumber(raw.bombs, 0, MAX_BOMBS, 0),
        cannonLevel: wholeNumber(raw.cannonLevel, 1, MAX_CANNON_LEVEL, 1),
    }
}

/** What to save after mission `run.mission` was completed (and whatever was bought since). */
export const checkpointFromRun = run => ({
    completed: run.mission,
    score: run.score,
    credits: run.credits,
    maxShield: run.maxShield,
    shield: run.shield,
    bombs: run.bombs,
    cannonLevel: run.cannonLevel,
})

/** A fresh run that continues from a checkpoint, at the mission after the one it completed. */
export const runFromCheckpoint = checkpoint => {
    const run = createRun()
    if (!checkpoint) return run
    return {
        ...run,
        mission: checkpoint.completed + 1,
        score: checkpoint.score,
        credits: checkpoint.credits,
        maxShield: checkpoint.maxShield,
        shield: checkpoint.shield,
        bombs: checkpoint.bombs,
        cannonLevel: checkpoint.cannonLevel,
    }
}

// Every storage access is guarded: a private window or blocked site data can make localStorage
// throw, and progress is a convenience the raid must work without.
const storage = () => {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null
    } catch (error) {
        return null
    }
}

/**
 * A progress record as kept in the browser or returned by the server: `{ checkpoint, savedAt,
 * pending }`. `checkpoint` null means "start over"; `pending` means the server has not got it yet.
 */
export const sanitizeRecord = raw => {
    if (!raw || typeof raw !== 'object') return null
    const savedAt = Number(raw.savedAt)
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null
    return {
        checkpoint: sanitizeCheckpoint(raw.checkpoint),
        savedAt: Math.floor(savedAt),
        pending: raw.pending === true,
    }
}

/**
 * Which copy to fly with: the browser's, or the server's. A save still `pending` in this browser
 * that is newer than the server's is pushed up; otherwise the server's copy wins (it may be from
 * another device) and replaces the local one. Returns `{ record, push }`.
 */
export const reconcile = (local, remote) => {
    if (local && local.pending && (!remote || local.savedAt > remote.savedAt)) return { record: local, push: true }
    if (remote) return { record: { ...remote, pending: false }, push: false }
    return { record: local, push: !!(local && local.pending) }
}

export const readRecord = scope => {
    try {
        const store = storage()
        const raw = store ? store.getItem(progressKey(scope)) : null
        return raw ? sanitizeRecord(JSON.parse(raw)) : null
    } catch (error) {
        return null
    }
}

export const writeRecord = (scope, record) => {
    try {
        const store = storage()
        if (!store) return
        if (record) store.setItem(progressKey(scope), JSON.stringify(record))
        else store.removeItem(progressKey(scope))
    } catch (error) {
        // The raid carries on; this browser just will not remember this one.
    }
}
