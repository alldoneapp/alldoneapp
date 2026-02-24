const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'
const OLD_ATTACHMENT = '0'

function sanitizeTokenText(value, fallback = 'attachment') {
    const safe = String(value || '')
        .trim()
        .replace(/\s+/g, '_')
    return safe || fallback
}

function buildAttachmentToken(uri, attachmentText) {
    return `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${sanitizeTokenText(
        attachmentText,
        'attachment'
    )}${ATTACHMENT_TRIGGER}${OLD_ATTACHMENT}`
}

function buildImageToken(uri, resizedUri, imageText) {
    const imageName = sanitizeTokenText(imageText, 'image')
    return `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${resizedUri}${IMAGE_TRIGGER}${imageName}${IMAGE_TRIGGER}${OLD_ATTACHMENT}`
}

function buildVideoToken(uri, videoText) {
    return `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${sanitizeTokenText(
        videoText,
        'video'
    )}${VIDEO_TRIGGER}${OLD_ATTACHMENT}`
}

module.exports = {
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    VIDEO_TRIGGER,
    OLD_ATTACHMENT,
    sanitizeTokenText,
    buildAttachmentToken,
    buildImageToken,
    buildVideoToken,
}
