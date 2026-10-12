import { translate } from '../../i18n/TranslationService'

export const formatAnnaActivityText = entryText => {
    if (typeof entryText !== 'string' || !entryText) return ''
    // Fixed feed phrases have locale entries. Generated/custom descriptions are
    // data, not guaranteed keys: preserve them without missing-key diagnostics
    // or interpreting placeholders inside user-authored text.
    return translate(entryText, { defaultValue: '' }) || entryText
}
