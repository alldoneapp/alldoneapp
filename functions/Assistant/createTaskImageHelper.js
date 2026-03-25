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

function injectCurrentMessageImagesIntoCreateTaskArgs(toolName, toolArgs, userContext = null) {
    if (toolName !== 'create_task') {
        return {
            toolArgs,
            usedCurrentMessageImages: false,
        }
    }

    const normalizedToolArgs = toolArgs && typeof toolArgs === 'object' ? { ...toolArgs } : {}
    const providedImages = normalizeCreateTaskImageUrls(normalizedToolArgs.images)
    if (providedImages.length > 0) {
        normalizedToolArgs.images = providedImages
        return {
            toolArgs: normalizedToolArgs,
            usedCurrentMessageImages: false,
        }
    }

    const contextImages = normalizeCreateTaskImageUrls(
        userContext?.currentMessageImageUrls || extractImageUrlsFromMessageContent(userContext?.content)
    )

    if (contextImages.length === 0) {
        delete normalizedToolArgs.images
        return {
            toolArgs: normalizedToolArgs,
            usedCurrentMessageImages: false,
        }
    }

    normalizedToolArgs.images = contextImages
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
    injectCurrentMessageImagesIntoCreateTaskArgs,
}
