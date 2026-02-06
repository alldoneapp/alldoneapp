const { removeColor } = require('./hashtagUtils')

const REGEX_KARMA = /^pMP4SB2IsTQr8LN[\S]+/
const REGEX_MILESTONE_TAG = /^qM54HU5TsTOe3Yw[\S]+qM54HU5TsTOe3Yw[\S]+/
const REGEX_VIDEO = /^ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+/
const REGEX_IMAGE = /^O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+/
const REGEX_ATTACHMENT = /^EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+/
const REGEX_HASHTAG = /(^|\s)(#[\S]+)$/i
const REGEX_MENTION = /^(@[\S]+)$/i

const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'
const MILESTONE_TAG_TRIGGER = 'qM54HU5TsTOe3Yw'

const MENTION_SPACE_CODE = 'M2mVOSjAVPPKweL'
const NOT_USER_MENTIONED = '0'

const CHAT_LAST_COMMENT_PREVIEW_CHARACTER_LIMIT = 150
const LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN = 25
const LAST_COMMENT_CHARACTER_LIMIT_IN_MEDIUM_SCREEN = 20
const LAST_COMMENT_CHARACTER_LIMIT_IN_SMALL_SCREEN = 15

const getAttachmentData = text => {
    const attachmentParts = text.split(ATTACHMENT_TRIGGER)
    const uri = attachmentParts[1]
    const attachmentText = attachmentParts[2]
    const isNew = attachmentParts[3]
    return { uri, attachmentText, isNew }
}

const getImageData = text => {
    const customImageParts = text.split(IMAGE_TRIGGER)
    const uri = customImageParts[1]
    const resizedUri = customImageParts[2]
    const imageText = customImageParts[3]
    const isNew = customImageParts[4]
    return { uri, resizedUri, imageText, isNew }
}

const getVideoData = text => {
    const videoParts = text.split(VIDEO_TRIGGER)
    const uri = videoParts[1]
    const videoText = videoParts[2]
    const isNew = videoParts[3]
    return { uri, videoText, isNew }
}

const getMentionData = (text, notRemoveTrigger) => {
    let userId
    let mentionText
    const mentionParts = text.split('#')

    if (mentionParts.length > 1) {
        userId = mentionParts[mentionParts.length - 1]
        mentionText = text.substring(notRemoveTrigger ? 0 : 1, text.length - userId.length - 1)
    } else {
        userId = NOT_USER_MENTIONED
        mentionText = notRemoveTrigger ? text : text.substring(1)
    }

    mentionText = mentionText.replaceAll(MENTION_SPACE_CODE, ' ')

    return { userId, mentionText }
}

const getMilestoneTagData = text => {
    const attachmentParts = text.split(MILESTONE_TAG_TRIGGER)
    const date = attachmentParts[1]
    const id = attachmentParts[2]
    return { text: date, milestoneId: id }
}

const shrinkTagText = (text, limit = 15, hideDots) => {
    if (!text) return ''
    if (text.length > limit) {
        text = text.substring(0, limit) + (hideDots ? '' : '...')
    }
    return text
}

const removeFormatTagsFromText = text => {
    return text
        ? text.replaceAll('[quote]', '').replaceAll('[header]', '').replaceAll('```', '').replaceAll('**', '')
        : ''
}

const cleanTextMetaData = (text = '', removeLineBreaks) => {
    const linealText = removeLineBreaks ? text.replace(/(\r\n|\n|\r)/gm, ' ') : text
    const words = linealText.replace(/<\/?[^>]+>/gi, '').split(' ')
    for (let i = 0; i < words.length; i++) {
        const word = words[i]
        if (REGEX_ATTACHMENT.test(word)) {
            const { attachmentText } = getAttachmentData(word)
            words[i] = attachmentText || 'Attachment'
        } else if (REGEX_IMAGE.test(word)) {
            const { imageText } = getImageData(word)
            words[i] = imageText || 'Image'
        } else if (REGEX_VIDEO.test(word)) {
            const { videoText } = getVideoData(word)
            words[i] = videoText || 'Video'
        } else if (REGEX_MENTION.test(word)) {
            const { mentionText } = getMentionData(word, true)
            words[i] = mentionText
        } else if (REGEX_HASHTAG.test(word)) {
            words[i] = removeColor(word)
        } else if (REGEX_KARMA.test(word)) {
            words[i] = 'Karma'
        } else if (REGEX_MILESTONE_TAG.test(word)) {
            words[i] = getMilestoneTagData(word).text
        }
    }
    return words.join(' ')
}

module.exports = {
    removeFormatTagsFromText,
    cleanTextMetaData,
    shrinkTagText,
    getMilestoneTagData,
    getMentionData,
    getVideoData,
    getImageData,
    getAttachmentData,
    CHAT_LAST_COMMENT_PREVIEW_CHARACTER_LIMIT,
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
    LAST_COMMENT_CHARACTER_LIMIT_IN_MEDIUM_SCREEN,
    LAST_COMMENT_CHARACTER_LIMIT_IN_SMALL_SCREEN,
}
