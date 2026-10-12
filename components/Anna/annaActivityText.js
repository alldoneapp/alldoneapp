import { translate } from '../../i18n/TranslationService'
import { cleanTextMetaData, removeFormatTagsFromText } from '../../functions/Utils/parseTextUtils'

export const formatAnnaActivityText = entryText => {
    if (typeof entryText !== 'string' || !entryText) return ''
    // Fixed feed phrases have locale entries. Generated/custom descriptions are
    // data, not guaranteed keys: preserve them without missing-key diagnostics
    // or interpreting placeholders inside user-authored text.
    return translate(entryText, { defaultValue: '' }) || entryText
}

// Display only text, never the markup/attachment URLs or mention IDs stored in comments.
export const annaActivityPreview = (value, limit = 240) => {
    if (typeof value !== 'string') return ''
    const text = cleanTextMetaData(removeFormatTagsFromText(value), true)
        .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}

export const getAnnaActivityLabel = notice => {
    const { content } = notice
    const action = content?.actionKey
        ? translate(content.actionKey, content.actionParams || {})
        : formatAnnaActivityText(content?.entryText || notice.entryText)
    const label =
        notice.kind === 'feed' ? annaActivityPreview(action) || translate('New update') : translate('New chat message')
    return content?.objectName ? `${label}: ${content.objectName}` : label
}
