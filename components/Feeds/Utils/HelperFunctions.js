import {
    URL_FEEDS_FOLLOWED,
    URL_FEEDS_NOT_FOLLOWED,
    URL_PROJECT_FEEDS_FOLLOWED,
    URL_PROJECT_FEEDS_NOT_FOLLOWED,
} from '../../../URLSystem/URLSystem'
import HelperFunctions from '../../../utils/HelperFunctions'
import { colors } from '../../styles/global'
import {
    ALL_TAB,
    FEED_ASSISTANT_CREATED,
    FEED_ASSISTANT_FOLLOWED,
    FEED_ASSISTANT_TYPES,
    FEED_ASSISTANT_UNFOLLOWED,
    FEED_CONTACT_ADDED,
    FEED_CONTACT_FOLLOWED,
    FEED_CONTACT_TYPES,
    FEED_CONTACT_UNFOLLOWED,
    FEED_GOAL_CREATED,
    FEED_GOAL_FOLLOWED,
    FEED_GOAL_TYPES,
    FEED_GOAL_UNFOLLOWED,
    FEED_NOTE_CREATED,
    FEED_NOTE_FOLLOWED,
    FEED_NOTE_TYPES,
    FEED_NOTE_UNFOLLOWED,
    FEED_PROJECT_CREATED,
    FEED_PROJECT_FOLLOWED,
    FEED_PROJECT_TYPES,
    FEED_PROJECT_UNFOLLOWED,
    FEED_SKILL_CREATED,
    FEED_SKILL_FOLLOWED,
    FEED_SKILL_TYPES,
    FEED_SKILL_UNFOLLOWED,
    FEED_TASK_CREATED,
    FEED_TASK_FOLLOWED,
    FEED_TASK_TO_ANOTHER_USER,
    FEED_TASK_TYPES,
    FEED_TASK_UNFOLLOWED,
    FEED_USER_FOLLOWED,
    FEED_USER_JOINED,
    FEED_USER_TYPES,
    FEED_USER_UNFOLLOWED,
    FOLLOWED_TAB,
} from './FeedsConstants'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { getDvMainTabLink } from '../../../utils/LinkingHelper'
import store from '../../../redux/store'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'

import { LOADED_MODE, NEW_ATTACHMENT, OLD_ATTACHMENT } from '../CommentsTextInput/textInputHelper'
import Backend from '../../../utils/BackendBridge'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { getAssistantInProject } from '../../AdminPanel/Assistants/assistantsHelper'
import { removeColor } from '../../../functions/Utils/hashtagUtils'
import {
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
    LAST_COMMENT_CHARACTER_LIMIT_IN_MEDIUM_SCREEN,
    LAST_COMMENT_CHARACTER_LIMIT_IN_SMALL_SCREEN,
    cleanTextMetaData,
    getAttachmentData,
    getImageData,
    getVideoData,
    removeFormatTagsFromText,
    shrinkTagText,
} from '../../../functions/Utils/parseTextUtils'

export const PAGINATION_AMOUNT = 100
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
export const REGEX_URL = /^((https?|ftp):\/\/[\S]+|(www\.[\S]+)|([\S]+\.[a-zA-Z]{2,}[\S]*))$|^http:\/\/localhost:[0-9]+\/[^\s.]{2,}(?!\.)$/i

export const REGEX_BOT_CODE = /```(.*?)```/g
export const REGEX_BOT_BOLD = /\*\*(.*?)\*\*/g

export const FORDWARD_COMMENT = 0
export const BACKWARD_COMMENT = 1
export const STAYWARD_COMMENT = 2

export const OBJECT_DATA = 0
export const OBJECT_DATA_TYPE = 1
export const OBJECT_DATA_ID = 2

export const CREATION_TYPES = [
    FEED_TASK_CREATED,
    FEED_TASK_TO_ANOTHER_USER,
    FEED_PROJECT_CREATED,
    FEED_CONTACT_ADDED,
    FEED_USER_JOINED,
    FEED_NOTE_CREATED,
    FEED_GOAL_CREATED,
    FEED_SKILL_CREATED,
    FEED_ASSISTANT_CREATED,
]

export const FOLLOWED_TYPES = [
    FEED_TASK_FOLLOWED,
    FEED_PROJECT_FOLLOWED,
    FEED_USER_FOLLOWED,
    FEED_CONTACT_FOLLOWED,
    FEED_NOTE_FOLLOWED,
    FEED_GOAL_FOLLOWED,
    FEED_SKILL_FOLLOWED,
    FEED_ASSISTANT_FOLLOWED,
]

export const UNFOLLOWED_TYPES = [
    FEED_TASK_UNFOLLOWED,
    FEED_PROJECT_UNFOLLOWED,
    FEED_USER_UNFOLLOWED,
    FEED_CONTACT_UNFOLLOWED,
    FEED_NOTE_UNFOLLOWED,
    FEED_GOAL_UNFOLLOWED,
    FEED_SKILL_UNFOLLOWED,
    FEED_ASSISTANT_UNFOLLOWED,
]

export const tryToextractPeopleForMention = (projectId, text) => {
    const REGEX_PEOPLE = /\/projects\/.+\/contacts\/.+\/.+$/i
    const REGEX_BACKLINKS_NOTES = /\/projects\/.+\/contacts\/.+\/backlinks\/notes$/i
    const REGEX_BACKLINKS_TASKS = /\/projects\/.+\/contacts\/.+\/backlinks\/tasks$/i
    const REGEX_PROPERTIES = /\/projects\/.+\/contacts\/.+\/properties$/i
    const REGEX_PROFILE = /\/projects\/.+\/contacts\/.+\/profile$/i
    const REGEX_UPDATES_ALL = /\/projects\/.+\/contacts\/.+\/updates\/all$/i
    const REGEX_UPDATES_WORKFLOW = /\/projects\/.+\/contacts\/.+\/workflow$/i
    const REGEX_UPDATES_STATISTICS = /\/projects\/.+\/contacts\/.+\/statistics$/i

    const peopleUrl = text.match(REGEX_PEOPLE)

    if (
        peopleUrl &&
        (REGEX_BACKLINKS_NOTES.test(text) ||
            REGEX_BACKLINKS_TASKS.test(text) ||
            REGEX_PROPERTIES.test(text) ||
            REGEX_PROFILE.test(text) ||
            REGEX_UPDATES_ALL.test(text) ||
            REGEX_UPDATES_WORKFLOW.test(text) ||
            REGEX_UPDATES_STATISTICS.test(text))
    ) {
        const people = extractPeopleUrlData(projectId, peopleUrl[0])
        return people ? people : null
    }

    return null
}

export const extractPeopleUrlData = (projectId, url) => {
    const urlParts = url.split('/')
    const mentionProjectId = urlParts[2]
    const peopleId = urlParts[4]
    return mentionProjectId === projectId ? getUserOrContactForMentions(projectId, peopleId) : null
}

export const getUserOrContactForMentions = (projectId, peopleId) => {
    const user = TasksHelper.getUserInProject(projectId, peopleId)
    if (user) {
        return {
            uid: peopleId,
            photoURL: user.photoURL,
            peopleName: user.displayName,
        }
    } else {
        const contact = TasksHelper.getContactInProject(projectId, peopleId)
        if (contact) {
            return {
                uid: peopleId,
                photoURL: contact.photoURL50,
                peopleName: contact.displayName,
            }
        }
        const assistant = getAssistantInProject(projectId, peopleId)
        if (assistant) {
            return {
                uid: peopleId,
                photoURL: assistant.photoURL50,
                peopleName: assistant.displayName,
            }
        }
    }

    return null
}

export const getURLConstantByFollowedState = (state, isAllProjects = false) => {
    switch (state) {
        case FOLLOWED_TAB:
            return isAllProjects ? URL_FEEDS_FOLLOWED : URL_PROJECT_FEEDS_FOLLOWED
        case ALL_TAB:
            return isAllProjects ? URL_FEEDS_NOT_FOLLOWED : URL_PROJECT_FEEDS_NOT_FOLLOWED
        default:
            return isAllProjects ? URL_FEEDS_FOLLOWED : URL_PROJECT_FEEDS_FOLLOWED
    }
}

export const parseBreakLineFeedComment = (text, bold) => {
    const linesElements = []

    if (text) {
        const lineBreakRegEx = /\r\n|\n|\r/
        const lines = text.split(lineBreakRegEx)
        for (let i = 0; i < lines.length; i++) {
            const line = i !== lines.length - 1 ? lines[i] + '\n' : lines[i]
            const commentElements = parseFeedComment(line, false, bold)
            linesElements.push(commentElements)
        }
    }

    return linesElements
}

export const parseFeedComment = (text, isGenericTask, bold) => {
    // DEBUG: Log input text for URL parsing analysis
    const hasUrlPattern = text && (text.includes('http') || text.includes('www.'))
    if (hasUrlPattern) {
        console.log('=== parseFeedComment URL DEBUG ===')
        console.log('Input text:', JSON.stringify(text))
    }

    // Filter out empty strings from split to handle multiple consecutive spaces
    const words = text.split(' ').filter(word => word.length > 0)

    if (hasUrlPattern) {
        console.log('Split into words:', words.length, 'words')
        words.forEach((w, i) => {
            if (w.includes('http') || w.includes('www.')) {
                console.log(`  Word[${i}]:`, JSON.stringify(w), '| REGEX_URL.test:', REGEX_URL.test(w))
            }
        })
    }

    const commentElements = []
    let needMarkWordLikeGeneric = isGenericTask
    for (let i = 0; i < words.length; i++) {
        const word = words[i]
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
                const punctuationElement = {
                    type: TEXT_ELEMENT,
                    text: punctuation,
                    bold,
                }
                commentElements.push(punctuationElement)
            }
        } else if (REGEX_URL.test(word)) {
            // Check if the word ends with punctuation that should be separated
            const urlMatch = word.match(/^(.*?)([\.,;:!?]*?)$/)
            if (urlMatch) {
                const urlPart = urlMatch[1]
                const punctuation = urlMatch[2]

                // Test if the URL part (without punctuation) is a valid URL
                if (REGEX_URL.test(urlPart)) {
                    commentElements.push({
                        type: URL_ELEMENT,
                        link: urlPart,
                    })

                    // Add any trailing punctuation as a separate text element
                    if (punctuation) {
                        commentElements.push({
                            type: TEXT_ELEMENT,
                            text: punctuation,
                            bold,
                        })
                    }
                } else {
                    // If the URL part isn't valid without punctuation, treat the whole thing as a URL
                    commentElements.push({
                        type: URL_ELEMENT,
                        link: word,
                    })
                }
            } else {
                commentElements.push({
                    type: URL_ELEMENT,
                    link: word,
                })
            }
        } else {
            // DEBUG: Log when a word containing URL pattern is NOT matched as URL
            if (word && (word.includes('http') || word.includes('www.'))) {
                console.log('=== URL NOT MATCHED - Added as TEXT ===')
                console.log('Word:', JSON.stringify(word))
                console.log('REGEX_URL.test result:', REGEX_URL.test(word))
            }
            commentElements.push({
                type: TEXT_ELEMENT,
                text: word,
                bold,
            })
        }
    }

    // DEBUG: Log final elements if URL patterns were in input
    if (hasUrlPattern) {
        const urlElements = commentElements.filter(e => e.type === URL_ELEMENT)
        const textElementsWithUrl = commentElements.filter(
            e => e.type === TEXT_ELEMENT && e.text && (e.text.includes('http') || e.text.includes('www.'))
        )
        console.log('=== parseFeedComment RESULT ===')
        console.log(
            'URL elements found:',
            urlElements.length,
            urlElements.map(e => e.link)
        )
        console.log(
            'Text elements containing URL patterns:',
            textElementsWithUrl.length,
            textElementsWithUrl.map(e => e.text)
        )
    }

    return commentElements
}

const searchRecordings = string => {
    return !string.search('video-record') || !string.search('screen-record')
}

export const updateNewAttachmentsData = async (projectId, text) => {
    store.dispatch(startLoadingData())
    const words = text.split(' ')

    for (let i = 0; i < words.length; i++) {
        const word = words[i]
        if (REGEX_ATTACHMENT.test(word)) {
            const { attachmentText, uri, isNew } = getAttachmentData(word)
            if (isNew === NEW_ATTACHMENT) {
                const file = await fetch(uri)
                    .then(r => r.blob())
                    .then(blobFile => new File([blobFile], attachmentText))
                const attachmentUri = await Backend.storeAttachment(projectId, file, false)
                words[
                    i
                ] = `${ATTACHMENT_TRIGGER}${attachmentUri}${ATTACHMENT_TRIGGER}${attachmentText}${ATTACHMENT_TRIGGER}${false}`
            }
        } else if (REGEX_IMAGE.test(word)) {
            const { imageText, uri, isNew } = getImageData(word)
            if (isNew === NEW_ATTACHMENT) {
                const IMAGE_HEIGHT = 200

                let imageResizedUri = uri
                let imageUri = uri
                try {
                    const resizedImage = await HelperFunctions.resizeImage(uri, IMAGE_HEIGHT)
                    const resizedFile = await HelperFunctions.convertURItoBlob(resizedImage.uri)
                    imageResizedUri = await Backend.storeAttachment(projectId, resizedFile, false)
                    const file = await HelperFunctions.convertURItoBlob(uri, imageText)
                    imageUri = await Backend.storeAttachment(projectId, file, false)
                } catch (error) {}

                words[
                    i
                ] = `${IMAGE_TRIGGER}${imageUri}${IMAGE_TRIGGER}${imageResizedUri}${IMAGE_TRIGGER}${imageText}${IMAGE_TRIGGER}${OLD_ATTACHMENT}`
            }
        } else if (REGEX_VIDEO.test(word)) {
            const { videoText, uri, isNew } = getVideoData(word)
            if (isNew === NEW_ATTACHMENT) {
                const file = await fetch(uri)
                    .then(r => r.blob())
                    .then(blobFile => new File([blobFile], videoText))
                store.dispatch(startLoadingData())
                const videoUri = /(Apple)/i.test(navigator.vendor)
                    ? await Backend.storeAttachment(projectId, file, false)
                    : searchRecordings(videoText)
                    ? await Backend.storeConvertedVideos(projectId, file)
                    : await Backend.storeAttachment(projectId, file, false)
                store.dispatch(stopLoadingData())
                words[i] = `${VIDEO_TRIGGER}${videoUri}${VIDEO_TRIGGER}${videoText}${VIDEO_TRIGGER}${false}`
            }
        }
    }

    store.dispatch(stopLoadingData())
    return words.join(' ')
}

export const updateNewAttachmentsDataInNotes = async (editor, id, text, uri, source) => {
    const ops = editor.getContents().ops
    const { quillEditorProjectId } = store.getState()
    const projectId = quillEditorProjectId

    for (let i = 0; i < ops.length; i++) {
        const { attachment, customImageFormat, videoFormat } = ops[i].insert
        if (attachment && attachment.id === id) {
            const file = await fetch(uri)
                .then(r => r.blob())
                .then(blobFile => new File([blobFile], text))
            const attachmentUri = await Backend.storeAttachment(projectId, file, true)
            ops[i].insert.attachment.uri = attachmentUri
            ops[i].insert.attachment.isLoading = LOADED_MODE
            break
        } else if (customImageFormat && customImageFormat.id === id) {
            try {
                const IMAGE_HEIGHT = 200
                const resizedImage = await HelperFunctions.resizeImage(uri, IMAGE_HEIGHT)
                const resizedFile = await HelperFunctions.convertURItoBlob(resizedImage.uri)
                const imageResizedUri = await Backend.storeAttachment(projectId, resizedFile, true)
                const file = await HelperFunctions.convertURItoBlob(uri, text)
                const imageUri = await Backend.storeAttachment(projectId, file, true)
                ops[i].insert.customImageFormat.uri = imageUri
                ops[i].insert.customImageFormat.resizedUri = imageResizedUri
            } catch (error) {
                ops[i].insert.customImageFormat.uri = uri
                ops[i].insert.customImageFormat.resizedUri = uri
            }
            ops[i].insert.customImageFormat.isLoading = LOADED_MODE
            break
        } else if (videoFormat && videoFormat.id === id) {
            const file = await fetch(uri)
                .then(r => r.blob())
                .then(blobFile => new File([blobFile], text))
            const videoUri = /(Apple)/i.test(navigator.vendor)
                ? await Backend.storeAttachment(projectId, file, true)
                : searchRecordings(text)
                ? await Backend.storeConvertedVideos(projectId, file)
                : await Backend.storeAttachment(projectId, file, true)
            ops[i].insert.videoFormat.uri = videoUri
            ops[i].insert.videoFormat.isLoading = LOADED_MODE
            break
        }
    }

    editor.setContents(ops, source)
}

export const generatorParserImageElement = (style, uri) => {
    return { type: 'image', style, uri }
}

export const generatorParserTextElement = (style, text) => {
    return { type: 'text', style, text }
}

export const generatorParserCustomElement = component => {
    return { type: 'custom', component }
}

export const generatorParserViewElement = style => {
    return { type: 'view', style }
}

export const isPicture = mimeType => {
    const mimeTypeList = [
        'image/bmp',
        'image/gif',
        'image/vnd.microsoft.icon',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/svg+xml',
        'image/tiff',
        'image/webp',
    ]

    return mimeTypeList.indexOf(mimeType) >= 0
}

export const getCommentTagColors = type => {
    if (type === FORDWARD_COMMENT) {
        return { backgroundColor: colors.UtilityGreen112, fontColor: colors.UtilityGreen200 }
    } else if (type === BACKWARD_COMMENT) {
        return { backgroundColor: colors.UtilityOrange112, fontColor: colors.UtilityOrange200 }
    } else {
        return { backgroundColor: colors.Grey300, fontColor: colors.Text03 }
    }
}

export const getCommentTagParsed = (comment, commentsAmount) => {
    const { smallScreenNavigation, isMiddleScreen } = store.getState()
    const textLimit = smallScreenNavigation
        ? LAST_COMMENT_CHARACTER_LIMIT_IN_SMALL_SCREEN
        : isMiddleScreen
        ? LAST_COMMENT_CHARACTER_LIMIT_IN_MEDIUM_SCREEN
        : LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN
    const cleanedComment = shrinkTagText(comment, textLimit)
    return `${cleanedComment}${commentsAmount > 1 ? ` +${commentsAmount - 1}` : ''}`
}

export const getTagCommentsPrivacyData = comments => {
    if (comments.length > 0) {
        const { commentType, commentText } = comments[comments.length - 1]
        return { lastComment: commentText, lastCommentType: commentType, amount: comments.length }
    }
    return null
}

export const getFeedObjectTypes = feedType => {
    if (FEED_TASK_TYPES.includes(feedType)) {
        return 'tasks'
    }
    if (FEED_PROJECT_TYPES.includes(feedType)) {
        return 'projects'
    }
    if (FEED_CONTACT_TYPES.includes(feedType)) {
        return 'contacts'
    }
    if (FEED_USER_TYPES.includes(feedType)) {
        return 'users'
    }
    if (FEED_NOTE_TYPES.includes(feedType)) {
        return 'notes'
    }
    if (FEED_GOAL_TYPES.includes(feedType)) {
        return 'goals'
    }
    if (FEED_SKILL_TYPES.includes(feedType)) {
        return 'skills'
    }
    if (FEED_ASSISTANT_TYPES.includes(feedType)) {
        return 'assistants'
    }
}

export const getObjectData = (data = OBJECT_DATA, commentedFeed) => {
    const { taskId, contactId, userId, goalId, noteId, skillId, assistantId } = commentedFeed

    if (taskId)
        return data === OBJECT_DATA ? { type: 'tasks', id: taskId } : data === OBJECT_DATA_TYPE ? 'tasks' : taskId
    else if (contactId)
        return data === OBJECT_DATA
            ? { type: 'contacts', id: contactId }
            : data === OBJECT_DATA_TYPE
            ? 'contacts'
            : contactId
    else if (noteId)
        return data === OBJECT_DATA ? { type: 'notes', id: noteId } : data === OBJECT_DATA_TYPE ? 'notes' : noteId
    else if (goalId)
        return data === OBJECT_DATA ? { type: 'goals', id: goalId } : data === OBJECT_DATA_TYPE ? 'goals' : goalId
    else if (skillId)
        return data === OBJECT_DATA ? { type: 'skills', id: skillId } : data === OBJECT_DATA_TYPE ? 'skills' : skillId
    else if (userId)
        return data === OBJECT_DATA ? { type: 'users', id: userId } : data === OBJECT_DATA_TYPE ? 'users' : userId
    else if (assistantId)
        return data === OBJECT_DATA
            ? { type: 'assistants', id: assistantId }
            : data === OBJECT_DATA_TYPE
            ? 'assistants'
            : assistantId
}

export const goToFeedSource = (navService, projectId, feedObjectType, sourceId) => {
    URLTrigger.processUrl(navService, getDvMainTabLink(projectId, sourceId, `${feedObjectType}s`))
}
