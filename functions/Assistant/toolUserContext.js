/**
 * The user's request as tools see it (`userContext`): the message the assistant is answering.
 *
 * Tools quote it back to the user and to other assistants: a VM host task's "Original request", the
 * request seeded into a delegated task, the words get_chat_attachment matches file names against,
 * and the text that may vouch for a VM run override (vmRunOverrideGuard). So it must be the message
 * being answered, never an older one. getOptimizedContextMessages returns the conversation oldest
 * first and ends with the triggering message, after the system prompt and any context messages.
 * Taking the FIRST user entry therefore picked the oldest message in the window: on 2026-11-16 a
 * crown-only badge brief said "do NOT merge" and quoted "Original request: merge it", a message
 * four hours older about another MR, and the screenshot sent with the real request was not
 * attached. Kept dependency-light so it can be unit-tested without loading assistantHelper.
 */

const { extractImageUrlsFromMessageContent } = require('./createTaskImageHelper')

// getOptimizedContextMessages appends the full text of @-mentioned notes to the triggering message
// so the model can read them. That context is not the user's words: it must not be posted as their
// request or count as their consent to a VM override. noteContextHelper builds it from this header.
const MENTIONED_NOTES_CONTEXT_HEADER =
    'Here are the mentioned notes in full - no need to use a tool to get the menioned notes:'

function withoutMentionedNotesContext(text) {
    if (typeof text !== 'string') return ''
    const index = text.indexOf(MENTIONED_NOTES_CONTEXT_HEADER)
    return index === -1 ? text : text.slice(0, index).trimEnd()
}

/**
 * The user's words in a context message's content, flattened like getMessageTextForTokenCounting
 * (images become "[Image]") but without the appended mentioned-notes context.
 */
function getUserRequestText(content) {
    if (!content) return ''
    if (typeof content === 'string') return withoutMentionedNotesContext(content)
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (!part || typeof part !== 'object') return ''
                if (part.type === 'text') return withoutMentionedNotesContext(part.text || '')
                if (part.type === 'image_url') return '[Image]'
                return ''
            })
            .filter(Boolean)
            .join(' ')
            .trim()
    }
    if (typeof content === 'object') return withoutMentionedNotesContext(content.content || '')
    return String(content)
}

/**
 * Build `userContext` from context messages (`[role, content]` entries): the LATEST user entry.
 * `content` keeps everything the model saw (including mentioned notes) for tool-loop continuations.
 */
function buildToolUserContext(messages) {
    const entries = Array.isArray(messages) ? messages : []
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (!Array.isArray(entry) || entry[0] !== 'user') continue
        const content = entry[1]
        return {
            message: getUserRequestText(content),
            content,
            currentMessageImageUrls: extractImageUrlsFromMessageContent(content),
        }
    }
    return null
}

module.exports = {
    MENTIONED_NOTES_CONTEXT_HEADER,
    getUserRequestText,
    buildToolUserContext,
}
