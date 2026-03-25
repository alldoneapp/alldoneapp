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

module.exports = {
    normalizeCreateTaskImageUrls,
    buildCreateTaskImageTokens,
    mergeTaskDescriptionWithImages,
}
