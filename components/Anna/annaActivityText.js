import { translate } from '../../i18n/TranslationService'
import { cleanTextMetaData, removeFormatTagsFromText } from '../../functions/Utils/parseTextUtils'
import { truncateActivityText } from './annaActivityLinks'

// Entry texts that assistant/MCP task updates wrote before AT-2906. They have no locale entry, so
// they showed in English next to the translated trigger feed for the same completion. Map them
// onto the fixed phrases that already exist, so stored activity reads in the user's language too.
const LEGACY_ENTRY_TEXTS = [
    [/^marked as complete$/, 'checked task as Done'],
    [/^marked as incomplete$/, 'changed task to Open'],
    [/^updated task( .+)?$/, 'updated task'],
]

export const normalizeAnnaEntryText = entryText => {
    const match = LEGACY_ENTRY_TEXTS.find(([pattern]) => pattern.test(entryText))
    return match ? match[1] : entryText
}

export const formatAnnaActivityText = entryText => {
    if (typeof entryText !== 'string' || !entryText) return ''
    const key = normalizeAnnaEntryText(entryText)
    // Fixed feed phrases have locale entries. Generated/custom descriptions are
    // data, not guaranteed keys: preserve them without missing-key diagnostics
    // or interpreting placeholders inside user-authored text.
    return translate(key, { defaultValue: '' }) || entryText
}

// Display only text, never the markup/attachment URLs or mention IDs stored in comments.
export const annaActivityPreview = (value, limit = 240) => {
    if (typeof value !== 'string') return ''
    const text = cleanTextMetaData(removeFormatTagsFromText(value), true)
        .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
    return truncateActivityText(text, limit)
}

// What happened, without the object: "Aufgabe als erledigt markiert", "Neue Chatnachricht".
export const getAnnaActivityAction = notice => {
    if (notice.kind !== 'feed') return translate('New chat message')
    const { content } = notice
    const action = content?.actionKey
        ? translate(content.actionKey, content.actionParams || {})
        : formatAnnaActivityText(content?.entryText || notice.entryText)
    return annaActivityPreview(action) || translate('New update')
}

export const getAnnaActivityLabel = notice => {
    const label = getAnnaActivityAction(notice)
    const objectName = notice.content?.objectName
    return objectName ? `${label}: ${objectName}` : label
}
