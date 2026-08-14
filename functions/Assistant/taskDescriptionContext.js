/**
 * Task description context helpers.
 *
 * A task description is a single plain string field (`items/{projectId}/tasks/{taskId}.description`)
 * that the rich-text editor fills with opaque sentinel tokens for embedded media, e.g.
 *
 *   O2TI5plHBf1QfdY<uri>O2TI5plHBf1QfdY<resizedUri>O2TI5plHBf1QfdY<label>O2TI5plHBf1QfdY<isNew>
 *
 * Those tokens used to be interpolated verbatim into the assistant/VM context, which meant an
 * image dropped into a task description reached the model as unreadable noise: the URL was in
 * there, but glued to an undocumented sentinel with nothing telling the model what it was.
 *
 * These helpers turn a raw description into (a) readable text and (b) a structured media list, so
 * both the interactive assistant and a VM run can actually use what is embedded in a description.
 * They deliberately do NOT fetch anything from Storage — attachments are surfaced as URLs and the
 * consumer downloads them if it needs the contents.
 */

const {
    REGEX_ATTACHMENT,
    REGEX_IMAGE,
    REGEX_VIDEO,
    getAttachmentData,
    getImageData,
    getVideoData,
    extractMediaContextFromText,
} = require('../Utils/parseTextUtils')

// Hard cap on how many description images are turned into vision content blocks for one prompt.
// Descriptions are unbounded, and every image block costs tokens on every single turn of the chat.
const TASK_DESCRIPTION_MAX_CONTEXT_IMAGES = 5

// Hard cap on the media list rendered into the text context.
const TASK_DESCRIPTION_MAX_CONTEXT_MEDIA = 20

/**
 * Replace media tokens with their human label while preserving every original whitespace
 * character.
 *
 * Note this intentionally does not reuse `cleanTextMetaData`: that helper splits on a literal
 * space, so a token immediately followed by a newline (very common in descriptions, where an
 * image sits on its own line) is treated as one "word" and the text after the newline is
 * swallowed along with the token. Splitting on a capturing whitespace group keeps the separators
 * intact and only ever replaces the token itself.
 */
const sanitizeTaskDescriptionText = description => {
    if (!description || typeof description !== 'string') return ''

    return description
        .split(/(\s+)/)
        .map(part => {
            if (!part || /^\s+$/.test(part)) return part
            if (REGEX_ATTACHMENT.test(part)) return getAttachmentData(part).attachmentText || 'Attachment'
            if (REGEX_IMAGE.test(part)) return getImageData(part).imageText || 'Image'
            if (REGEX_VIDEO.test(part)) return getVideoData(part).videoText || 'Video'
            return part
        })
        .join('')
        .trim()
}

/**
 * Structured media embedded in a task description: `{ kind, fileName, mimeType, storageUrl, previewUrl }`.
 */
const extractTaskDescriptionMedia = description => {
    if (!description || typeof description !== 'string') return []
    return extractMediaContextFromText(description).slice(0, TASK_DESCRIPTION_MAX_CONTEXT_MEDIA)
}

/**
 * Image URLs embedded in a task description, ready to be passed as vision content blocks.
 */
const extractTaskDescriptionImageUrls = (description, limit = TASK_DESCRIPTION_MAX_CONTEXT_IMAGES) => {
    const urls = extractTaskDescriptionMedia(description)
        .filter(media => media.kind === 'image')
        .map(media => media.storageUrl || media.previewUrl || '')
        .filter(Boolean)

    return [...new Set(urls)].slice(0, Math.max(0, limit))
}

/**
 * The text block listing everything embedded in a description, appended to the canonical task
 * context. This is what makes description media usable from a VM run (which has no vision channel
 * but can `curl` a URL) and from any tool-using assistant.
 */
const buildTaskDescriptionMediaContextLines = description => {
    const media = extractTaskDescriptionMedia(description)
    if (media.length === 0) return ''

    const lines = media.map(item => {
        const label = item.fileName || item.kind || 'file'
        const mimeType = item.mimeType && item.mimeType !== 'application/octet-stream' ? item.mimeType : item.kind
        return `- ${label} (${mimeType}): ${item.storageUrl}`
    })

    return `Files embedded in the task description (downloadable via the URLs):\n${lines.join('\n')}`
}

module.exports = {
    TASK_DESCRIPTION_MAX_CONTEXT_IMAGES,
    TASK_DESCRIPTION_MAX_CONTEXT_MEDIA,
    sanitizeTaskDescriptionText,
    extractTaskDescriptionMedia,
    extractTaskDescriptionImageUrls,
    buildTaskDescriptionMediaContextLines,
}
