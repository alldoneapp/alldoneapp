// Pure module: the web app imports it too, so it must not require anything server-only.
//
// What an artifact row calls "edited" comes from many documents written over six years, and not all
// of them hold a usable time. Legacy tasks from 2020 carry `lastEditionDate: 9007199254740991`
// (Number.MAX_SAFE_INTEGER, the old "Someday"/backlog sentinel): a finite number, so it passed every
// `Number(x) || 0` guard, sorted above everything and rendered as "Invalid date", because it lies past
// the last instant a JavaScript Date can hold (AT-2887). Others are Firestore Timestamps, seconds, or
// strings. Every artifact date goes through `toArtifactTimestamp`, which answers with epoch
// milliseconds or 0 for "unknown" — never a guess.

// Nothing in Alldone predates 2000, and nothing legitimately sits two centuries ahead. A value outside
// that window is a sentinel or a unit mistake, not a time.
const MIN_ARTIFACT_TIMESTAMP = Date.UTC(2000, 0, 1)
const MAX_ARTIFACT_TIMESTAMP = Date.UTC(2200, 0, 1)

function inRange(ms) {
    return Number.isFinite(ms) && ms >= MIN_ARTIFACT_TIMESTAMP && ms <= MAX_ARTIFACT_TIMESTAMP
}

function fromNumber(value) {
    if (!Number.isFinite(value) || value <= 0) return 0
    if (inRange(value)) return Math.round(value)
    // Epoch seconds (a Firestore Timestamp's `seconds`, or a value written by a server in seconds).
    if (value < MIN_ARTIFACT_TIMESTAMP && inRange(value * 1000)) return Math.round(value * 1000)
    return 0
}

// Epoch milliseconds, or 0 when the value is not a trustworthy time.
function toArtifactTimestamp(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return 0
    if (typeof value === 'number') return fromNumber(value)
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return 0
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return fromNumber(Number(trimmed))
        const parsed = Date.parse(trimmed)
        return Number.isFinite(parsed) ? fromNumber(parsed) : 0
    }
    if (value instanceof Date) return fromNumber(value.getTime())
    if (typeof value === 'object') {
        if (typeof value.toMillis === 'function') {
            try {
                return fromNumber(value.toMillis())
            } catch (_) {
                return 0
            }
        }
        // A Timestamp that went through JSON: the client SDK's `{seconds, nanoseconds}`, the Admin
        // SDK's `{_seconds, _nanoseconds}`.
        const seconds = value.seconds ?? value._seconds
        const nanoseconds = value.nanoseconds ?? value._nanoseconds ?? 0
        if (typeof seconds === 'number' && Number.isFinite(seconds)) {
            const ms = seconds * 1000 + (Number(nanoseconds) || 0) / 1e6
            return inRange(ms) ? Math.round(ms) : 0
        }
    }
    return 0
}

// The first candidate that is a real time: `firstArtifactTimestamp(doc.lastEditionDate, doc.created)`
// falls back to the creation time when the edition stamp is a sentinel.
function firstArtifactTimestamp(...candidates) {
    for (const candidate of candidates) {
        const ms = toArtifactTimestamp(candidate)
        if (ms) return ms
    }
    return 0
}

module.exports = {
    MIN_ARTIFACT_TIMESTAMP,
    MAX_ARTIFACT_TIMESTAMP,
    toArtifactTimestamp,
    firstArtifactTimestamp,
}
