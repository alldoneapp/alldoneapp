const fbConfig = require('../firebaseConfig')
const { removeColor, matchAnyColor } = require('./hashtagUtils')
const { shrinkTagText } = require('./parseTextUtils')

const TEXT_ELEMENT = 'text'
const HASH_ELEMENT = 'hash'
const MENTION_ELEMENT = 'mention'
const EMAIL_ELEMENT = 'email'
const URL_ELEMENT = 'url'
const KARMA_ELEMENT = 'karma'
const SIZE_TITLE = 'size_title'
const SIZE_COMMENT = 'size_comment'

const HASHTAG_COLOR_MAPPING = {
    // UtilityRed300
    ['#BD0303']: {
        tagText: '#BD0303', // UtilityRed300
        tagBack: '#FFD6D6', // UtilityRed112
    },
    // UtilityYellow300
    ['#F58E0A']: {
        tagText: '#F58E0A', // UtilityYellow300
        tagBack: '#FFEDD6', // UtilityYellow112
    },
    // UtilityGreen300
    ['#07A873']: {
        tagText: '#07A873', // UtilityGreen300
        tagBack: '#C7F5E5', // UtilityGreen112
    },
    // UtilityBlue300
    ['#0070E0']: {
        tagText: '#0070E0', // UtilityBlue300
        tagBack: '#D6EBFF', // UtilityBlue112
    },
    // UtilityViolet300
    ['#702EE6']: {
        tagText: '#702EE6', // UtilityViolet300
        tagBack: '#E5D6FF', // UtilityViolet112
    },
}

const parseRichText = text => {
    const hashTagRegEx = /^#[\S]+/i
    const mentionRegEx = /^@[\S]+/i
    const emailRegEx = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/i
    const urlRegEx = /https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9\u00a1-\uffff?@:%][a-zA-Z0-9-\u00a1-\uffff?@:%]+[a-zA-Z0-9\u00a1-\uffff?@:%]\.[^\s]{2,}|www\.[a-zA-Z0-9\u00a1-\uffff?@:%][a-zA-Z0-9-\u00a1-\uffff?@:%]+[a-zA-Z0-9\u00a1-\uffff?@:%]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9\u00a1-\uffff?@:%]+\.[^\s]{2,}|www\.[a-zA-Z0-9\u00a1-\uffff?@:%]+\.[^\s]{2,}/i
    const MENTION_SPACE_CODE_REGEX = /M2mVOSjAVPPKweL/g
    const KARMA_TRIGGER = 'pMP4SB2IsTQr8LN'

    const words = text.split(' ')
    const textElements = []

    for (let i = 0; i < words.length; i++) {
        const word = words[i]
        const lastElementIndex = textElements.length - 1

        if (hashTagRegEx.test(word)) {
            textElements.push({
                type: HASH_ELEMENT,
                text: word.substring(1),
            })
        } else if (mentionRegEx.test(word)) {
            let { mention, photoURL } = getDataFromMention(word)

            if (photoURL != null) {
                textElements.push({
                    type: MENTION_ELEMENT,
                    text: mention.substring(1).replace(MENTION_SPACE_CODE_REGEX, ' '),
                    photoURL: photoURL,
                })
            } else {
                textElements.push({
                    type: MENTION_ELEMENT,
                    text: word.substring(1),
                })
            }
        } else if (emailRegEx.test(word)) {
            textElements.push({
                type: EMAIL_ELEMENT,
                email: word,
            })
        } else if (word.startsWith(KARMA_TRIGGER)) {
            textElements.push({
                type: KARMA_ELEMENT,
                photoURL: getDataFromMention(word).photoURL,
            })
        } else if (urlRegEx.test(word)) {
            // Check if the word ends with punctuation that should be separated
            const urlMatch = word.match(/^(.*?)([\.,;:!?]*?)$/)
            if (urlMatch) {
                const urlPart = urlMatch[1]
                const punctuation = urlMatch[2]

                // Test if the URL part (without punctuation) is a valid URL
                if (urlRegEx.test(urlPart)) {
                    textElements.push({
                        type: URL_ELEMENT,
                        link: urlPart,
                    })

                    // Add any trailing punctuation as a separate text element
                    if (punctuation) {
                        if (
                            textElements[textElements.length - 1] &&
                            textElements[textElements.length - 1].type === TEXT_ELEMENT
                        ) {
                            textElements[textElements.length - 1].text += punctuation
                        } else {
                            textElements.push({
                                type: TEXT_ELEMENT,
                                text: punctuation,
                            })
                        }
                    }
                } else {
                    // If the URL part isn't valid without punctuation, treat the whole thing as a URL
                    textElements.push({
                        type: URL_ELEMENT,
                        link: word,
                    })
                }
            } else {
                textElements.push({
                    type: URL_ELEMENT,
                    link: word,
                })
            }
        } else {
            if (textElements[lastElementIndex] && textElements[lastElementIndex].type === TEXT_ELEMENT) {
                textElements[lastElementIndex].text += ` ${word}`
            } else {
                textElements.push({
                    type: TEXT_ELEMENT,
                    text: word,
                })
            }
        }
    }

    return textElements
}

const getDomain = link => {
    let hostname = link

    if (link.indexOf('//') > -1) {
        hostname = link.split('//')[1]
    }
    hostname = hostname.replace('www.', '')
    return shrinkTagText(hostname)
}

const getDataFromMention = mention => {
    const mentionData = { mention: mention, photoURL: null }

    if (mention.trim().indexOf('###') >= 0) {
        const parts = mention.trim().split('###')

        if (parts.length === 2) {
            mentionData.mention = parts[0]
            mentionData.photoURL = parts[1]
        }
    }
    return mentionData
}

const buildTag = (element, size = SIZE_TITLE) => {
    const { type, text, link, email } = element

    if (type === TEXT_ELEMENT) {
        return `${text} `
    } else {
        let tagContent = text
        let bgColor = '#ede6fa'
        let textColor = '#702ee6'
        let iconURL = `${fbConfig.app_url}icons/tags/`
        let linkURL = null
        let avatar = null
        let linkClass = 'rich-text-email'

        let tagSizeStyle = 'height: 24px; padding: 0px 10px 0px 4px;'
        let textSizeStyle = 'font-size: 14px; line-height: 22px; letter-spacing: 0.01em;'
        let iconParentStyle = 'padding: 2px 4px 0px 0px;'
        let karmaParentStyle = 'padding: 2px 2px 0px 8px;'

        if (size === SIZE_COMMENT) {
            tagSizeStyle = 'height: 20px; padding: 0px 8px 0px 3px;'
            textSizeStyle = 'font-size: 12px; line-height: 18px; letter-spacing: 0.03em;'
            iconParentStyle = 'padding: 0px 4px 0px 0px;'
            karmaParentStyle = 'padding: 1px 1px 0px 6px;'
        }

        let isAvatar = false
        let isKarma = false

        if (type === HASH_ELEMENT) {
            const color = matchAnyColor(text, true)

            tagContent = removeColor(text)
            bgColor = HASHTAG_COLOR_MAPPING[color].tagBack
            textColor = HASHTAG_COLOR_MAPPING[color].tagText
            iconURL += `hash.${textColor.substr(1)}.png`
        } else if (type === MENTION_ELEMENT) {
            tagContent = text
            bgColor = '#ADF0D9'
            textColor = '#07A873'
            iconURL = element.hasOwnProperty('photoURL') ? element.photoURL : iconURL + 'at-sign.png'
            isAvatar = element.hasOwnProperty('photoURL')
        } else if (type === EMAIL_ELEMENT) {
            tagContent = shrinkTagText(email)
            bgColor = '#FFE6C7'
            textColor = '#F58E0A'
            iconURL += 'mail.png'
            linkURL = `mailto:${email}`
            linkClass = 'rich-text-email'
        } else if (type === KARMA_ELEMENT) {
            tagContent = 'Karma'
            bgColor = '#D6EBFF'
            textColor = '#007FFF'
            iconURL += 'thumb-up.png'
            avatar = element.photoURL
            isKarma = true
        } else if (type === URL_ELEMENT) {
            tagContent = getDomain(link)
            bgColor = '#D6EBFF'
            textColor = '#007FFF'
            iconURL += 'link.png'
            linkURL = link
            linkClass = 'rich-text-link'
        }

        let avatarStyle
        if (isAvatar || isKarma) {
            tagSizeStyle = isAvatar
                ? 'height: 24px; padding: 0px 10px 0px 2px;'
                : 'height: 24px; padding: 0px 0px 0px 4px;'
            avatarStyle = 'border-radius: 50px; width: 20px; height: 20px;'
            if (size === SIZE_COMMENT) {
                tagSizeStyle = isAvatar
                    ? 'height: 20px; padding: 0px 8px 0px 1px;'
                    : 'height: 20px; padding: 0px 0px 0px 3px;'
                avatarStyle = 'border-radius: 50px; width: 16px; height: 16px;'
                iconParentStyle = isAvatar ? 'padding: 1px 4px 0px 1px;' : iconParentStyle
            }
        }

        return `<table border="0" class="colored-tag" style="background-color: ${bgColor}; ${tagSizeStyle}">
                    <tr>
                        <td style="${iconParentStyle}">
                        ${
                            isAvatar
                                ? `
                            <img
                                class="colored-icon"
                                src="${iconURL}"
                                alt=""
                                width="20"
                                height="20"
                                style="${avatarStyle}"
                            />
                            `
                                : `
                            <img
                                class="colored-icon"
                                src="${iconURL}"
                                alt=""
                                width="16"
                                height="20"
                            />
                          `
                        }
                        </td>
                        
                        <td class="colored-text" style="${textSizeStyle} color: ${textColor};" >
                            ${
                                linkURL
                                    ? `
                                            <a class="${linkClass}" style="color: ${textColor};" href="${linkURL}" target="_blank">
                                                ${tagContent}
                                            </a>`
                                    : `${tagContent}`
                            }
                        </td>
                        
                        ${
                            isKarma
                                ? `
                                <td style="${karmaParentStyle}">
                                    <img
                                        class="colored-icon"
                                        src="${avatar}"
                                        alt=""
                                        width="20"
                                        height="20"
                                        style="${avatarStyle}"
                                    />
                                </td>
                            `
                                : ''
                        }
                    </tr>
                </table>`
    }
}

module.exports = {
    TEXT_ELEMENT,
    HASH_ELEMENT,
    MENTION_ELEMENT,
    EMAIL_ELEMENT,
    URL_ELEMENT,
    KARMA_ELEMENT,
    SIZE_TITLE,
    SIZE_COMMENT,
    parseRichText,
    buildTag,
}
