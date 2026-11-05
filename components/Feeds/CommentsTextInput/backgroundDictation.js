/**
 * PT-5425: a push-to-talk dictation whose host finishes it in the BACKGROUND (the add-task popup
 * closes on release and creates the task once the transcript is back). By then the editor is gone,
 * so the text cannot be inserted into it; instead the draft is split at the caret when the user lets
 * go, and the transcript is placed between the two halves once it arrives — the same position the
 * interactive path inserts it at.
 */

export const LINKED_URL_KEYS = [
    'linkedTasksUrls',
    'linkedNotesUrls',
    'linkedContactsUrls',
    'linkedProjectsUrls',
    'linkedGoalsUrls',
    'linkedSkillsUrls',
    'linkedAssistantUrls',
    'linkedArtifactsUrls',
]

/**
 * @param {{ beforeText?: string, afterText?: string, dictatedText?: string }} parts
 *   `beforeText`/`afterText` are the draft's serialized text left and right of the caret (with any
 *   selected text already removed, as the interactive insertion replaces a selection);
 *   `dictatedText` is the already-normalized transcript.
 * @returns {string|null} the final text, or null when there is nothing dictated to add — a
 *   transcript that normalizes away must never submit the untouched draft (see CustomTextInput3's
 *   `dictationInsertedRef` for the same rule on the interactive path).
 */
export const composeDictationAroundCaret = ({ beforeText = '', afterText = '', dictatedText = '' } = {}) => {
    if (!dictatedText) return null
    const leading = beforeText && !/\s$/.test(beforeText) ? ' ' : ''
    const trailing = afterText && !/^\s/.test(afterText) ? ' ' : ''
    return `${beforeText}${leading}${dictatedText}${trailing}${afterText}`
}

/** Union of the linked-object URL lists of the two draft halves, without duplicates. */
export const mergeLinkedUrls = (...parts) => {
    const merged = {}
    LINKED_URL_KEYS.forEach(key => {
        const urls = []
        parts.forEach(part => {
            ;(part?.[key] || []).forEach(url => {
                if (!urls.includes(url)) urls.push(url)
            })
        })
        merged[key] = urls
    })
    return merged
}
