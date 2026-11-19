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
    isImageDownloadError,
    stripInputImagesFromResponsesInput,
}
