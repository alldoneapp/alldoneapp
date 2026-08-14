/**
 * Shared dueDate validation for the server-side task funnels.
 *
 * A task's dueDate is always a Unix timestamp in milliseconds: a positive,
 * finite number (Number.MAX_SAFE_INTEGER encodes "Someday"). The funnels fed
 * by model-authored JSON (assistant tool calls and the MCP server) used to
 * write whatever arrived under dueDate straight to Firestore — production
 * carried tasks whose dueDate held an entire task object. Firestore and
 * Algolia accept such values silently; only the Typesense schema rejects
 * them, so the funnels must refuse before persisting. Rejecting (rather than
 * silently dropping the field) lets the model retry with a corrected value.
 */

const DUE_DATE_GUIDANCE =
    'Provide a Unix timestamp in milliseconds or an ISO 8601 date string (e.g. "2026-01-15T18:00:00"), ' +
    'or 9007199254740991 (Number.MAX_SAFE_INTEGER) for "Someday".'

const MAX_QUOTED_STRING_LENGTH = 60

const quoteForError = value =>
    value.length > MAX_QUOTED_STRING_LENGTH ? `${value.slice(0, MAX_QUOTED_STRING_LENGTH)}…` : value

// Deliberately never serializes objects/arrays into the message: the known
// production garbage was an entire task object, which would bloat the tool
// error (and the conversation history it lands in).
const describeDueDateValue = value => {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'an array'
    const type = typeof value
    if (type === 'object') return 'an object'
    if (type === 'boolean') return `a boolean (${value})`
    if (type === 'number') return `an invalid number (${value})`
    return `a ${type}`
}

/**
 * Validates a dueDate that is about to be persisted, after any ISO-string →
 * milliseconds conversion. `undefined` (field not provided) passes through;
 * anything else must be a positive finite number of milliseconds.
 *
 * @param {*} processedValue - The value headed for Firestore.
 * @param {*} rawValue - The value as it arrived (pre-conversion), used to
 *   build an actionable error for unparseable date strings.
 * @returns {*} processedValue when valid (or undefined when not provided).
 * @throws {Error} A model-actionable error for any other value.
 */
const validateDueDateForPersistence = (processedValue, rawValue = processedValue) => {
    if (processedValue === undefined) return processedValue
    if (typeof processedValue === 'number' && Number.isFinite(processedValue) && processedValue > 0) {
        return processedValue
    }
    if (typeof rawValue === 'string') {
        throw new Error(
            `Invalid dueDate: could not interpret "${quoteForError(rawValue)}" as a date. ${DUE_DATE_GUIDANCE}`
        )
    }
    throw new Error(`Invalid dueDate: received ${describeDueDateValue(rawValue)}. ${DUE_DATE_GUIDANCE}`)
}

module.exports = {
    validateDueDateForPersistence,
}
