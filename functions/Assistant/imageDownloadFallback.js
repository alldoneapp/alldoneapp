'use strict'

/**
 * Lets a run go on when the model provider cannot download one of its images.
 *
 * OpenAI fetches every `input_image` URL itself and rejects the whole request when one fails:
 * `400 Error while downloading file. Upstream status code: 403.` A single broken image link — an
 * address the model once made up and that was stored on a task, a deleted upload, an expired
 * link — then failed every later run of that task, workflow AI steps included, before the model
 * read a word. The images are context, not the request, so the run is retried once without them
 * and the model is told that they were left out.
 */

const OMITTED_IMAGE_NOTE = '[An attached image could not be loaded and was left out.]'
const DUPLICATE_IMAGE_NOTE = '[This image is also attached to a later message in this conversation.]'

/**
 * Old task descriptions/comments can contain the same image or a model-abbreviated URL.
 * Keep the most recent occurrence of each image (at the same detail level), replacing older
 * copies and visibly abbreviated links with notes before either token counting or dispatch.
 * This only changes the outgoing request, never the saved conversation or attachment bytes.
 */
function normalizeResponsesImageInput(input) {
    if (!Array.isArray(input)) return { input, omittedCount: 0, duplicateCount: 0 }
    const normalized = [...input]
    const seen = new Set()
    let omittedCount = 0
    let duplicateCount = 0

    for (let i = input.length - 1; i >= 0; i--) {
        const item = input[i]
        if (!Array.isArray(item?.content)) continue
        const content = [...item.content]
        let changed = false
        for (let j = content.length - 1; j >= 0; j--) {
            const part = content[j]
            if (part?.type !== 'input_image') continue
            let abbreviated = false
            if (typeof part.image_url === 'string' && /^https?:\/\//i.test(part.image_url)) {
                try {
                    const path = decodeURIComponent(new URL(part.image_url).pathname)
                    abbreviated = path.split('/').some(segment => segment === '...' || segment === '…')
                } catch (_) {}
            }
            if (abbreviated) {
                content[j] = { type: 'input_text', text: OMITTED_IMAGE_NOTE }
                omittedCount++
                changed = true
                continue
            }
            const key = JSON.stringify([part.image_url || '', part.file_id || '', part.detail || 'auto'])
            if (!part.image_url && !part.file_id) continue
            if (seen.has(key)) {
                content[j] = { type: 'input_text', text: DUPLICATE_IMAGE_NOTE }
                duplicateCount++
                changed = true
            } else {
                seen.add(key)
            }
        }
        if (changed) normalized[i] = { ...item, content }
    }

    return { input: omittedCount || duplicateCount ? normalized : input, omittedCount, duplicateCount }
}

function isImageDownloadError(error) {
    if (!error) return false
    const status = Number(error.status || error.statusCode || 0)
    if (status && status !== 400) return false
    const code = String(error.code || error.error?.code || '').toLowerCase()
    if (code === 'invalid_image_url' || code === 'image_url_unavailable') return true
    const message = String(error.message || error.error?.message || '').toLowerCase()
    return message.includes('error while downloading file') || message.includes('invalid_image_url')
}

/**
 * Replaces every `input_image` part of a Responses API `input` with a short text note.
 * Returns the new input and how many images were removed; the input is not mutated.
 */
function stripInputImagesFromResponsesInput(input) {
    if (!Array.isArray(input)) return { input, removedCount: 0 }

    let removedCount = 0
    const stripped = input.map(item => {
        if (!item || !Array.isArray(item.content)) return item
        if (!item.content.some(part => part?.type === 'input_image')) return item
        return {
            ...item,
            content: item.content.map(part => {
                if (part?.type !== 'input_image') return part
                removedCount += 1
                return { type: 'input_text', text: OMITTED_IMAGE_NOTE }
            }),
        }
    })

    return { input: removedCount > 0 ? stripped : input, removedCount }
}

module.exports = {
    OMITTED_IMAGE_NOTE,
    DUPLICATE_IMAGE_NOTE,
    normalizeResponsesImageInput,
    isImageDownloadError,
    stripInputImagesFromResponsesInput,
}
