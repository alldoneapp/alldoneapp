const { buildImageToken } = require('../WhatsApp/whatsAppMediaTokens')

function normalizeCreateTaskImageUrls(images) {
    if (!Array.isArray(images)) return []

    const seen = new Set()

    return images
        .map(image => (typeof image === 'string' ? image.trim() : ''))
        .filter(image => {
            if (!image) return false
            if (!/^https?:\/\//i.test(image)) return false
            if (seen.has(image)) return false
            seen.add(image)
            return true
        })
}

function getImageLabelFromUrl(url, fallbackIndex = 0) {
    if (typeof url !== 'string' || !url.trim()) return `image-${fallbackIndex + 1}`

    try {
        const parsed = new URL(url)
        const pathSegments = parsed.pathname.split('/').filter(Boolean)
        const lastSegment = pathSegments[pathSegments.length - 1] || ''
        const decoded = decodeURIComponent(lastSegment).trim()
        return decoded || `image-${fallbackIndex + 1}`
    } catch (_) {
        const normalized = url.split('?')[0].split('#')[0]
        const pathSegments = normalized.split('/').filter(Boolean)
        return pathSegments[pathSegments.length - 1] || `image-${fallbackIndex + 1}`
    }
}

function buildCreateTaskImageTokens(images) {
    return normalizeCreateTaskImageUrls(images)
        .map((imageUrl, index) => buildImageToken(imageUrl, imageUrl, getImageLabelFromUrl(imageUrl, index)))
        .join(' ')
}

function mergeTaskDescriptionWithImages(description, images) {
    const normalizedDescription = typeof description === 'string' ? description.trim() : ''
    const imageTokens = buildCreateTaskImageTokens(images)

    if (!imageTokens) return normalizedDescription
    if (!normalizedDescription) return imageTokens

    return `${normalizedDescription}\n\n${imageTokens}`
}

function extractImageUrlsFromMessageContent(content) {
    if (!Array.isArray(content)) return []

    const seen = new Set()
    const imageUrls = []

    content.forEach(part => {
        const url = typeof part?.image_url?.url === 'string' ? part.image_url.url.trim() : ''
        if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return
        seen.add(url)
        imageUrls.push(url)
    })

    return imageUrls
}

const STORAGE_HOSTS = ['firebasestorage.googleapis.com', 'storage.googleapis.com']

function isStorageHostUrl(url) {
    try {
        return STORAGE_HOSTS.includes(new URL(url).hostname.toLowerCase())
    } catch (_) {
        return false
    }
}

/**
 * Whether an image URL the model passed to create_task was made up rather than copied.
 *
 * The model sees an attached image as pixels, never as an address, so when it fills `images` for
 * the screenshot it was sent it can only guess. One guess was
 * `https://storage.googleapis.com/alldonealeph.appspot.com/...`, with a literal "...": it replaced
 * the real upload, was embedded in the task and its request comment, and every later run of the
 * task failed because the model provider could not download it (OpenAI 400 "Error while
 * downloading file. Upstream status code: 403"). Two kinds of URL are treated as guesses:
 * - one that is visibly abbreviated ("..." or "…"), whatever the message carried;
 * - one in Alldone's own Storage while the current message carries images but not that URL: it
 *   can only be an attempt at naming those images.
 */
function isInventedCreateTaskImageUrl(url, contextImages = []) {
    if (contextImages.includes(url)) return false
    let decoded = url
    try {
        decoded = decodeURIComponent(url)
    } catch (_) {}
    if (decoded.includes('...') || decoded.includes('…')) return true
    return contextImages.length > 0 && isStorageHostUrl(url)
}

function injectCurrentMessageImagesIntoCreateTaskArgs(toolName, toolArgs, userContext = null) {
    if (toolName !== 'create_task') {
        return {
            toolArgs,
            usedCurrentMessageImages: false,
        }
    }

    const normalizedToolArgs = toolArgs && typeof toolArgs === 'object' ? { ...toolArgs } : {}
    const contextImages = normalizeCreateTaskImageUrls(
        userContext?.currentMessageImageUrls || extractImageUrlsFromMessageContent(userContext?.content)
    )
    const providedImages = normalizeCreateTaskImageUrls(normalizedToolArgs.images)
    const keptImages = providedImages.filter(url => !isInventedCreateTaskImageUrl(url, contextImages))
    const droppedImages = providedImages.filter(url => !keptImages.includes(url))
    if (droppedImages.length > 0) {
        console.warn('create_task: dropped image URLs the model made up', { droppedImages })
    }

    if (keptImages.length > 0 && droppedImages.length === 0) {
        normalizedToolArgs.images = keptImages
        return {
            toolArgs: normalizedToolArgs,
            usedCurrentMessageImages: false,
        }
    }

    if (contextImages.length === 0) {
        if (keptImages.length > 0) {
            normalizedToolArgs.images = keptImages
            return {
                toolArgs: normalizedToolArgs,
                usedCurrentMessageImages: false,
            }
        }
        delete normalizedToolArgs.images
        return {
            toolArgs: normalizedToolArgs,
            usedCurrentMessageImages: false,
        }
    }

    // A made-up URL was an attempt at the attached images, so they take its place.
    normalizedToolArgs.images = [...new Set([...keptImages, ...contextImages])]
    return {
        toolArgs: normalizedToolArgs,
        usedCurrentMessageImages: true,
    }
}

module.exports = {
    normalizeCreateTaskImageUrls,
    buildCreateTaskImageTokens,
    mergeTaskDescriptionWithImages,
    extractImageUrlsFromMessageContent,
    isInventedCreateTaskImageUrl,
    injectCurrentMessageImagesIntoCreateTaskArgs,
}
