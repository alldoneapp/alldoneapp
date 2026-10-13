// Shared inline token parser. Keep this independent of navigation, Redux and Firebase
// so embedded task titles can reuse it without importing the feed backend.
import { getUrlTokenParts, REGEX_URL, splitMarkdownLinks } from './linkDetection'

export const TEXT_ELEMENT = 'text'
export const HASH_ELEMENT = 'hash'
export const ATTACHMENT_ELEMENT = 'attachment'
export const IMAGE_ELEMENT = 'image'
export const VIDEO_ELEMENT = 'video'
export const GENERIC_ELEMENT = 'generic'
export const MENTION_ELEMENT = 'mention'
export const EMAIL_ELEMENT = 'email'
export const URL_ELEMENT = 'url'
export const KARMA_ELEMENT = 'karma'
export const MILESTONE_TAG_ELEMENT = 'milestoneTag'

export const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'
export const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
export const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'
export const KARMA_TRIGGER = 'pMP4SB2IsTQr8LN'
export const MILESTONE_TAG_TRIGGER = 'qM54HU5TsTOe3Yw'

export const MENTION_SPACE_CODE = 'M2mVOSjAVPPKweL'
export const BREAKLINE_CODE = '1UzPvQttIwgbqFX'

export const REGEX_KARMA = /^pMP4SB2IsTQr8LN[\S]+/
export const REGEX_MILESTONE_TAG = /^qM54HU5TsTOe3Yw[\S]+qM54HU5TsTOe3Yw[\S]+/
export const REGEX_VIDEO = /^ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+ptPQsef7OeB5eWd[\S]+/
export const REGEX_IMAGE = /^O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+/
export const REGEX_ATTACHMENT = /^EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+EbDsQTD14ahtSR5[\S]+/
export const REGEX_GENERIC = /^(&[\S]+)$/i
export const REGEX_HASHTAG = /(^|\s)(#[\S]+)$/i
export const REGEX_MENTION = /^(@[\S]+)$/i
export const REGEX_EMAIL = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)([,.])?/i
export { REGEX_URL }

export const parseFeedComment = (text, isGenericTask, bold) => {
    const commentElements = []
    let needMarkWordLikeGeneric = isGenericTask

    const addTextElement = textToAdd => {
        if (textToAdd) {
            commentElements.push({
                type: TEXT_ELEMENT,
                text: textToAdd,
                bold,
            })
        }
    }

    const parseWord = word => {
        if (needMarkWordLikeGeneric && REGEX_GENERIC.test(word)) {
            needMarkWordLikeGeneric = false
            commentElements.push({
                type: GENERIC_ELEMENT,
                text: word.substring(1),
            })
        } else if (REGEX_KARMA.test(word)) {
            commentElements.push({
                type: KARMA_ELEMENT,
                text: word,
            })
        } else if (REGEX_MILESTONE_TAG.test(word)) {
            commentElements.push({
                type: MILESTONE_TAG_ELEMENT,
                text: word,
            })
        } else if (REGEX_ATTACHMENT.test(word)) {
            commentElements.push({
                type: ATTACHMENT_ELEMENT,
                text: word,
            })
        } else if (REGEX_IMAGE.test(word)) {
            commentElements.push({
                type: IMAGE_ELEMENT,
                text: word,
            })
        } else if (REGEX_VIDEO.test(word)) {
            commentElements.push({
                type: VIDEO_ELEMENT,
                text: word,
            })
        } else if (REGEX_HASHTAG.test(word)) {
            commentElements.push({
                type: HASH_ELEMENT,
                text: word.substring(1),
            })
        } else if (REGEX_MENTION.test(word)) {
            commentElements.push({
                type: MENTION_ELEMENT,
                text: word.substring(1),
            })
        } else if (REGEX_EMAIL.test(word)) {
            const emailMatch = word.match(REGEX_EMAIL)
            const email = emailMatch[1]

            // Add the email element without any punctuation
            const emailElement = {
                type: EMAIL_ELEMENT,
                text: email,
                email: email,
            }
            commentElements.push(emailElement)

            // Add any trailing punctuation as a separate text element
            const punctuation = emailMatch[2]
            if (punctuation) {
                addTextElement(punctuation)
            }
        } else {
            const urlParts = getUrlTokenParts(word)
            if (urlParts) {
                addTextElement(urlParts.prefix)
                commentElements.push({ type: URL_ELEMENT, link: urlParts.url })
                addTextElement(urlParts.suffix)
            } else {
                addTextElement(word)
            }
        }
    }

    splitMarkdownLinks(text).forEach(segment => {
        if (segment.type === 'url') {
            commentElements.push({ type: URL_ELEMENT, link: segment.value })
        } else {
            // Filter out empty strings to retain the parser's existing whitespace behavior.
            segment.value
                .split(' ')
                .filter(word => word.length > 0)
                .forEach(parseWord)
        }
    })

    return commentElements
}
