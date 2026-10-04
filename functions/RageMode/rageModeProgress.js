/**
 * The rage-mode raid's saved progress — the SERVER's copy of the checkpoint rules, so progress
 * follows the player across devices. The client copy (`components/RageMode/raidProgress.js`) decides
 * the same things for the copy it keeps in the browser; Functions code cannot enter the web bundle,
 * hence two copies, and `raidProgress.test.js` fails the build if they ever disagree.
 *
 * A checkpoint is game progress for fun: the mission completed plus shield, bombs, upgrades, credits
 * and score as they left the hangar. Credits only buy in-run consumables (never Gold), so a forged
 * checkpoint cheats nobody but its author — but every number is still clamped to what the game could
 * have produced, so garbage can never be stored.
 */

const LIMITS = Object.freeze({
    maxMission: 999,
    maxNumber: 10000000,
    baseMaxShield: 100,
    shieldCap: 175,
    maxBombs: 5,
    maxCannonLevel: 3,
})

const wholeNumber = (value, min, max, fallback) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.max(min, Math.min(max, Math.floor(number)))
}

/** A checkpoint, or null if `raw` is not one (nothing saved, or a cleared "start over"). */
const sanitizeCheckpoint = raw => {
    if (!raw || typeof raw !== 'object') return null
    const completed = wholeNumber(raw.completed, 0, LIMITS.maxMission, 0)
    const maxShield = wholeNumber(raw.maxShield, LIMITS.baseMaxShield, LIMITS.shieldCap, LIMITS.baseMaxShield)
    // Before mission 1 is cleared a checkpoint can still hold credits banked from lost games.
    const credits = wholeNumber(raw.credits, 0, LIMITS.maxNumber, 0)
    const cannonLevel = wholeNumber(raw.cannonLevel, 1, LIMITS.maxCannonLevel, 1)
    if (completed < 1 && credits <= 0 && cannonLevel <= 1 && maxShield <= LIMITS.baseMaxShield) return null
    return {
        completed,
        score: wholeNumber(raw.score, 0, LIMITS.maxNumber, 0),
        credits,
        maxShield,
        shield: wholeNumber(raw.shield, 1, maxShield, maxShield),
        bombs: wholeNumber(raw.bombs, 0, LIMITS.maxBombs, 0),
        cannonLevel,
    }
}

/** The stored progress record: `{ checkpoint, savedAt }`, or null when nothing was ever saved. */
const normalizeProgress = raw => {
    if (!raw || typeof raw !== 'object') return null
    const savedAt = Number(raw.savedAt)
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null
    return { checkpoint: sanitizeCheckpoint(raw.checkpoint), savedAt: Math.floor(savedAt) }
}

module.exports = { LIMITS, normalizeProgress, sanitizeCheckpoint }
