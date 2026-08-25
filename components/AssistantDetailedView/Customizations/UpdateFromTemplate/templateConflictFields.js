import { translate } from '../../../../i18n/TranslationService'

/**
 * Human names for the assistant settings a template sync can conflict on.
 *
 * Extracted from `UpdateFromTemplate` so a surface that only wants to SAY what
 * changed does not have to import the resolve panel — that module pulls in
 * `resolveAssistantTemplateConflicts`, i.e. the whole Firestore client, which is
 * the wrong dependency for a read-only notice on the assistant board (AT-2425).
 * `UpdateFromTemplate` re-exports `formatTemplateConflictField`, so its existing
 * importers and tests are unaffected.
 */
export const FIELD_LABEL_KEYS = {
    displayName: 'Name',
    description: 'Description',
    emailSignature: 'Email signature',
    emailModel: 'Inbound email model',
    heartbeatModel: 'Heartbeat model',
    heartbeatReasoningEffort: 'Heartbeat reasoning effort',
    model: 'Assistant model',
    reasoningEffort: 'Reasoning effort',
    temperature: 'Temperature',
}

export const formatTemplateConflictField = field => {
    const labelKey = FIELD_LABEL_KEYS[field]
    if (labelKey) return translate(labelKey)

    const readable = String(field || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : ''
}

/**
 * The changed settings, named, in conflict order — deduplicated because the
 * generic fallback above can map two raw fields onto the same readable label,
 * and a notice that reads "Instructions, Instructions" looks like a bug.
 * Unnameable entries are dropped rather than rendered as an empty gap.
 */
export const getTemplateConflictFieldNames = assistant => {
    const conflicts = Array.isArray(assistant?.templateSyncConflicts) ? assistant.templateSyncConflicts : []
    const names = []
    conflicts.forEach(conflict => {
        const name = formatTemplateConflictField(conflict?.field)
        if (name && !names.includes(name)) names.push(name)
    })
    return names
}
