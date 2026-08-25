import { QuillDeltaToHtmlConverter } from 'quill-delta-to-html'
import v4 from 'uuid/v4'
import ReactQuill from 'react-quill-new'
import Quill from 'quill'

import {
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    KARMA_TRIGGER,
    MENTION_SPACE_CODE,
    REGEX_ATTACHMENT,
    REGEX_EMAIL,
    REGEX_GENERIC,
    REGEX_HASHTAG,
    REGEX_IMAGE,
    REGEX_KARMA,
    REGEX_MENTION,
    REGEX_MILESTONE_TAG,
    REGEX_URL,
    REGEX_VIDEO,
    tryToextractPeopleForMention,
    VIDEO_TRIGGER,
} from '../Utils/HelperFunctions'
import { formatUrl, getDvMainTabLink, getUrlObject } from '../../../utils/LinkingHelper'
import { cloneDeep } from 'lodash'
import Backend from '../../../utils/BackendBridge'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'
import {
    getAttachmentData,
    getImageData,
    getMentionData,
    getMilestoneTagData,
    getVideoData,
} from '../../../functions/Utils/parseTextUtils'

export const MENTION_MODAL_TASKS_TAB = 0
export const MENTION_MODAL_GOALS_TAB = 1
export const MENTION_MODAL_NOTES_TAB = 2
export const MENTION_MODAL_CONTACTS_TAB = 3
export const MENTION_MODAL_TOPICS_TAB = 4

export const ATTACHMENTS_SELECTOR_MODAL_ID = '0'
export const RECORD_VIDEO_MODAL_ID = '1'
export const RECORD_SCREEN_MODAL_ID = '2'

export const LOADING_MODE = '0'
export const LOADED_MODE = '1'

export const NEW_ATTACHMENT = '1'
export const OLD_ATTACHMENT = '0'

export const NOT_ALLOW_EDIT_TAGS = '0'
export const NOT_USER_MENTIONED = '0'
export const USER_ID_LENGTH = 28
export const USER_ID_SEPARATOR_LENGTH = 1
export const ALLOWED_FORMATS = ['hashtag', 'mention', 'url', 'email']
export const NOT_PLAIN_TEXT_SYMBOL = '&'
export const MENTION_MODAL_WIDTH = 305
export const MENTION_MODAL_RIGHT_MARGIN = 15
export const TAG_INTERACTION_CLASS = 'TAG_INTERACTION_CLASS'

export const TASK_THEME = 0
export const SUBTASK_THEME = 1
export const COMMENT_MODAL_THEME = 2
export const NEW_TOPIC_MODAL_THEME = 3
export const SEARCH_THEME = 4
export const INVITE_THEME_DEFAULT = 5
export const INVITE_THEME_MODERN = 51
export const CREATE_TASK_MODAL_THEME = 6
export const CREATE_PROJECT_THEME_DEFAULT = 71
export const CREATE_PROJECT_THEME_MODERN = 72
export const CREATE_SUBTASK_MODAL_THEME = 8
export const GOAL_THEME = 9

export const QUILL_EDITOR_TEXT_INPUT_TYPE = '0'
export const QUILL_EDITOR_NOTE_TYPE = '1'

export const imageExtensionsSupported = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp']
export const videoExtensionsSupported = [
    'webm',
    'mp4',
    'mkv',
    'flv',
    'vob',
    'ogv',
    'ogg',
    'avi',
    'mov',
    'wmv',
    'rm',
    'rmvb',
    'mpg',
    'mpeg',
    '3gp',
    '3g2',
]

const Delta = ReactQuill.Quill.import('delta')

export const getFileExtension = fileName => {
    const parts = fileName.split('.')
    return parts.length > 1 && parts[parts.length - 1] ? parts[parts.length - 1] : ''
}

export const fileIsImage = fileName => {
    const ext = getFileExtension(fileName).toLowerCase()
    return imageExtensionsSupported.includes(ext)
}

export const fileIsVideo = fileName => {
    const ext = getFileExtension(fileName).toLowerCase()
    return videoExtensionsSupported.includes(ext)
}

export const insertAttachmentInsideEditor = (inputCursorIndex, editor, text, uri, id, isLoading) => {
    if (fileIsImage(text)) {
        insertCustomImage(inputCursorIndex, editor, text, uri, id, isLoading)
    } else if (fileIsVideo(text)) {
        insertVideo(inputCursorIndex, editor, text, uri, id, isLoading)
    } else {
        insertAttachmentTag(inputCursorIndex, editor, text, uri, id, isLoading)
    }
}

// The editorMeta module (quill2Setup) decodes the app-encoded placeholder during init and
// then overwrites `options.placeholder` with the visible text only, so reading the raw
// option here yields no metadata once the editor is live (AT-2227: every embed inserted
// after init was stamped with `editorId: undefined`, which left images stuck on the
// loading placeholder because their project could no longer be resolved). Read the decoded
// metadata first and fall back to the raw placeholder for headless editors, which are
// built with plain `new Quill(node)` and never run the module.
export const getEditorMetaFromEditor = editor =>
    editor?.editorMeta ? editor.editorMeta : getPlaceholderData(editor?.options?.placeholder || '')

export const getEditorId = editor => getEditorMetaFromEditor(editor).editorId

const insertAttachmentTag = (inputCursorIndex, editor, text, uri, id, isLoading) => {
    const editorId = getEditorId(editor)
    const attachment = { text, uri, isNew: NEW_ATTACHMENT, externalId: id, isLoading, editorId }
    const delta = new Delta()
    delta.retain(inputCursorIndex)
    delta.insert({ attachment })
    delta.insert(' ')
    editor.updateContents(delta, 'user')
    editor.setSelection(inputCursorIndex + 3, 0, 'user')
}

const insertCustomImage = (inputCursorIndex, editor, text, uri, id, isLoading) => {
    const editorId = getEditorId(editor)

    const customImageFormat = { text, uri, resizedUri: uri, isNew: NEW_ATTACHMENT, externalId: id, isLoading, editorId }
    const delta = new Delta()
    delta.retain(inputCursorIndex)
    delta.insert(' ')
    delta.insert({ customImageFormat })
    delta.insert(' ')
    editor.updateContents(delta, 'user')
    editor.setSelection(inputCursorIndex + 3, 0, 'user')
}

const insertVideo = (inputCursorIndex, editor, text, uri, id, isLoading) => {
    const editorId = getEditorId(editor)

    const videoFormat = { text, uri, isNew: NEW_ATTACHMENT, externalId: id, isLoading, editorId }
    const delta = new Delta()
    delta.retain(inputCursorIndex)
    delta.insert(' ')
    delta.insert({ videoFormat })
    delta.insert(' ')
    editor.updateContents(delta, 'user')
    editor.setSelection(inputCursorIndex + 3, 0, 'user')
}

export const checkIfInputHaveKarma = editor => {
    let hasKarma = false
    const ops = [...editor.getContents().ops]
    for (let i = 0; i < ops.length; i++) {
        const { karma } = ops[i].insert
        if (karma) {
            hasKarma = true
        }
    }
    return hasKarma
}

export const updateKarmaInInput = (userGettingKarmaId, editor, inputCursorIndex) => {
    const editorId = getEditorId(editor)

    let needToAddKarma = true

    const ops = [...editor.getContents().ops]
    for (let i = 0; i < ops.length; i++) {
        const { karma } = ops[i].insert
        if (karma) {
            needToAddKarma = false
            ops.splice(i, 1)
            editor.setContents(ops, 'user')
            editor.setSelection(inputCursorIndex, 0, 'user')
            break
        }
    }

    if (needToAddKarma) {
        const karma = { userId: userGettingKarmaId ? userGettingKarmaId : '0', editorId }
        const delta = new Delta()
        delta.retain(inputCursorIndex)
        delta.insert({ karma })
        delta.insert(' ')
        editor.updateContents(delta, 'user')
        editor.setSelection(inputCursorIndex + 2, 0, 'user')
    }
}

export const getQuillEditorRef = (quillNoteRef, quillTextInputRefs, tagEditorId) => {
    if (quillNoteRef) {
        const placeholder = quillNoteRef.props.placeholder
        const { editorId } = getPlaceholderData(placeholder)

        if (editorId === tagEditorId) {
            return { editorRef: quillNoteRef, inNote: true }
        }
    }

    return quillTextInputRefs[tagEditorId]
        ? { editorRef: quillTextInputRefs[tagEditorId] }
        : { editorRef: quillNoteRef, inNote: true }
}

export const createPlaceholder = (
    placeholderText,
    editorType,
    editorId,
    keyboardType,
    singleLine,
    userIdAllowedToEditTags,
    disabledEnterKey
) => {
    return `${placeholderText}#${editorType ? editorType : ''}#${editorId ? editorId : ''}#${
        keyboardType ? keyboardType : ''
    }#${singleLine ? singleLine : ''}#${userIdAllowedToEditTags ? userIdAllowedToEditTags : ''}#${
        disabledEnterKey ? disabledEnterKey : ''
    }`
}

export const getPlaceholderData = placeholder => {
    const data = placeholder.split('#')
    return {
        placeholderText: data[0],
        editorType: data[1],
        editorId: data[2],
        keyboardType: data[3],
        singleLine: data[4],
        userIdAllowedToEditTags: data[5],
        disabledEnterKey: data[6],
    }
}

export const cleanTagsInteractionsPopus = () => {
    const tagInteractioPopups = document.getElementsByClassName(TAG_INTERACTION_CLASS)
    for (let i = 0; i < tagInteractioPopups.length; i++) {
        tagInteractioPopups[i].remove()
    }
}

export const getElementOffset = element => {
    const rectangle = element ? element.getBoundingClientRect() : { top: 0, left: 0 }
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    return { top: rectangle.top + scrollTop, left: rectangle.left + scrollLeft }
}

export const editorIsTextInput = editorPlaceholder => {
    const placeholderEncodeDataRegExp = /#textinput$/
    const placeholder = editorPlaceholder
    return placeholderEncodeDataRegExp.test(placeholder)
}

export const updateTextUsingDeltaOps = (deltaOps, previousText, setText) => {
    let newText = previousText
    let index = 0
    let tagWasInserted = false
    deltaOps.forEach(op => {
        const retained = op.retain
        let inserted = op.insert
        const deleted = op.delete

        if (retained) {
            index += retained
        } else if (inserted) {
            const {
                mention,
                hashtag,
                email,
                url,
                image,
                commentTagFormat,
                attachment,
                customImageFormat,
                videoFormat,
                karma,
                taskTagFormat,
                milestoneTag,
            } = inserted
            if (
                url ||
                mention ||
                hashtag ||
                email ||
                image ||
                commentTagFormat ||
                attachment ||
                customImageFormat ||
                videoFormat ||
                karma ||
                taskTagFormat ||
                milestoneTag
            ) {
                inserted = NOT_PLAIN_TEXT_SYMBOL
                tagWasInserted = true
            } else if (tagWasInserted && inserted.match(/\n$/)) {
                inserted = inserted.substring(0, inserted.length - 1)
            }

            newText = newText.substring(0, index) + inserted + newText.substring(index)
            index += inserted.length
        } else {
            newText = newText.substring(0, index) + newText.substring(index + deleted)
        }
    })

    setText(newText)
    return newText
}

export const getKarmaData = text => {
    const attachmentParts = text.split(KARMA_TRIGGER)
    const userId = attachmentParts[1]
    return { userId }
}

export const getAttachmentTagName = (fileName, smallScreenNavigation, isMiddleScreen) => {
    const parts = fileName.split('.')
    let ext = ''
    let name = fileName
    if (parts.length > 1 && parts[parts.length - 1]) {
        ext = parts[parts.length - 1]
        name = fileName.substring(0, fileName.length - ext.length)
    }

    const maxCharacters = smallScreenNavigation ? 15 : isMiddleScreen ? 20 : 25
    return name.length > maxCharacters ? `${name.substring(0, maxCharacters)}...${ext}` : `${name}${ext}`
}

export const processPastedTextWithBreakLines = (
    text,
    Delta,
    projectId,
    editorId,
    userIdAllowedToEditTags,
    inGenericTask,
    genericData,
    editor,
    inNote,
    attributes,
    inPaste
) => {
    const delta = new Delta()
    const isFomatedLink = attributes && attributes.link && REGEX_URL.test(attributes.link)
    const isFormatedList = attributes && attributes.list
    const lines = isFomatedLink ? [text] : text.split('\n')
    const maxLineIndex = lines.length - 1
    let hasKarma = false
    lines.forEach((line, lineIndex) => {
        const words = isFomatedLink ? [line] : line.split(/\s/)
        const maxWordIndex = words.length - 1

        words.forEach((word, index) => {
            if (inGenericTask && REGEX_GENERIC.test(word)) {
                const { parentObjectId, parentType, assistantId } = genericData
                const commentTagFormat = {
                    text: word.substring(1),
                    editorId,
                    projectId,
                    parentObjectId,
                    parentType,
                    assistantId,
                }
                delta.insert({ commentTagFormat })
                isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
            } else if (!inNote && REGEX_KARMA.test(word)) {
                if (!hasKarma && !checkIfInputHaveKarma(editor)) {
                    hasKarma = true
                    const { userId } = getKarmaData(word)
                    const karma = { userId, editorId }
                    delta.insert({ karma })
                    isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
                }
            } else if (!inNote && REGEX_MILESTONE_TAG.test(word)) {
                const { text, milestoneId } = getMilestoneTagData(word)
                const id = v4()
                const milestoneTag = { text: text, id, editorId, milestoneId, userIdAllowedToEditTags }
                delta.insert({ milestoneTag })
                isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
            } else if (REGEX_ATTACHMENT.test(word)) {
                if (!inPaste || !checkIsLimitedByTraffic(projectId)) {
                    const { uri, attachmentText, isNew } = getAttachmentData(word)
                    const attachment = { text: attachmentText, uri, isNew, editorId }
                    delta.insert({ attachment })
                }
                isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
            } else if (REGEX_IMAGE.test(word)) {
                if (!inPaste || !checkIsLimitedByTraffic(projectId)) {
                    const { uri, resizedUri, imageText, isNew } = getImageData(word)
                    const customImageFormat = { text: imageText, uri, resizedUri, isNew, editorId }
                    delta.insert({ customImageFormat })
                    isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
                }
            } else if (REGEX_VIDEO.test(word)) {
                if (!inPaste || !checkIsLimitedByTraffic(projectId)) {
                    const { uri, videoText, isNew } = getVideoData(word)
                    const videoFormat = { text: videoText, uri, isNew, editorId }
                    delta.insert({ videoFormat })
                    isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
                }
            } else if (REGEX_HASHTAG.test(word)) {
                const id = v4()
                const hashtag = { text: word.substring(1), id, editorId, userIdAllowedToEditTags }
                delta.insert({ hashtag })
                isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
            } else if (REGEX_MENTION.test(word)) {
                const { userId, mentionText } = getMentionData(word)
                const id = v4()
                const mention = { text: mentionText, id, userId, editorId, userIdAllowedToEditTags }
                delta.insert({ mention })
                isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
            } else if (REGEX_EMAIL.test(word)) {
                const emailMatch = word.match(REGEX_EMAIL)
                const id = v4()
                // Create email object with just the email part, no punctuation
                const emailText = emailMatch[1]
                const email = { text: emailText, id, editorId, userIdAllowedToEditTags }
                delta.insert({ email })

                // Add any trailing punctuation as a separate insert
                const punctuation = emailMatch[2]
                if (punctuation) {
                    delta.insert(punctuation)
                }
                delta.insert(' ')
            } else if (isFomatedLink || REGEX_URL.test(word)) {
                let urlToProcess = isFomatedLink ? attributes.link : word
                let trailingPunctuation = ''

                // If it's not a formatted link, check for trailing punctuation
                if (!isFomatedLink) {
                    const urlMatch = word.match(/^(.*?)([\.,;:!?]*?)$/)
                    if (urlMatch && urlMatch[2]) {
                        const urlPart = urlMatch[1]
                        const punctuation = urlMatch[2]

                        // Test if the URL part (without punctuation) is a valid URL
                        if (REGEX_URL.test(urlPart)) {
                            urlToProcess = urlPart
                            trailingPunctuation = punctuation
                        }
                    }
                }

                const people = tryToextractPeopleForMention(projectId, urlToProcess)
                if (people) {
                    const { peopleName, uid } = people
                    const id = v4()
                    const mention = { text: peopleName, id, userId: uid, editorId, userIdAllowedToEditTags }
                    delta.insert({ mention })
                    isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
                } else {
                    const execRes = formatUrl(urlToProcess)
                    if (execRes) {
                        const url = getUrlObject(urlToProcess, execRes, projectId, editorId, userIdAllowedToEditTags)

                        if (isFomatedLink) delta.insert(' ')

                        const { type, objectId, url: objectUrl } = url
                        if (type === 'task' && inNote) {
                            const taskTagFormat = { id: v4(), taskId: objectId, editorId, objectUrl }
                            delta.insert({
                                taskTagFormat,
                            })
                        } else {
                            delta.insert({
                                url,
                            })
                        }

                        // Add any trailing punctuation
                        if (trailingPunctuation) {
                            delta.insert(trailingPunctuation)
                        }

                        isFormatedList ? delta.insert(' ', attributes) : delta.insert(' ')
                    }
                }
            } else {
                const parsedWord = index < maxWordIndex ? `${word} ` : word
                attributes ? delta.insert(parsedWord, attributes) : delta.insert(parsedWord)
            }
        })
        if (lineIndex < maxLineIndex) {
            if (delta.ops.length > 0 && typeof delta.ops[delta.ops.length - 1].insert === 'string') {
                delta.ops[delta.ops.length - 1].insert = delta.ops[delta.ops.length - 1].insert + '\n'
            } else {
                attributes ? delta.insert('\n', attributes) : delta.insert('\n')
            }
        }
    })

    return delta
}

export const getLinkedTasksIdsFromText = (text, projectId) => {
    const words = text.trim().split(/\s/)
    const tasksIds = []
    words.forEach(word => {
        let urlToProcess = word

        // Check for trailing punctuation and remove it for URL processing
        const urlMatch = word.match(/^(.*?)([\.,;:!?]*?)$/)
        if (urlMatch && urlMatch[2] && REGEX_URL.test(urlMatch[1])) {
            urlToProcess = urlMatch[1]
        }

        if (REGEX_URL.test(urlToProcess) && formatUrl(urlToProcess)) {
            const execRes = formatUrl(urlToProcess)
            if (execRes) {
                const url = getUrlObject(urlToProcess, execRes, projectId, null, null)
                const { type, objectId } = url
                if (type === 'task') tasksIds.push(objectId)
            }
        }
    })

    return tasksIds
}

export const processPastedText = (
    text,
    Delta,
    projectId,
    editorId,
    userIdAllowedToEditTags,
    inGenericTask,
    genericData,
    editor,
    inNote,
    attributes,
    inPaste
) => {
    const words = text.split(/\s/)
    const maxWordIndex = words.length - 1

    const delta = new Delta()
    let hasKarma = false
    words.forEach((word, index) => {
        if (inGenericTask && REGEX_GENERIC.test(word)) {
            const { parentObjectId, parentType, assistantId } = genericData
            const commentTagFormat = {
                text: word.substring(1),
                editorId,
                projectId,
                parentObjectId,
                parentType,
                assistantId,
            }
            delta.insert({ commentTagFormat })
            delta.insert(' ')
        } else if (!inNote && REGEX_KARMA.test(word)) {
            if (!hasKarma && !checkIfInputHaveKarma(editor)) {
                hasKarma = true
                const { userId } = getKarmaData(word)
                const karma = { userId, editorId }
                delta.insert({ karma })
                delta.insert(' ')
            }
        } else if (!inNote && REGEX_MILESTONE_TAG.test(word)) {
            const { text, milestoneId } = getMilestoneTagData(word)
            const id = v4()
            const milestoneTag = { text: text, id, editorId, milestoneId, userIdAllowedToEditTags }
            delta.insert({ milestoneTag })
            delta.insert(' ')
        } else if (REGEX_ATTACHMENT.test(word)) {
            if (!inPaste || !checkIsLimitedByTraffic(projectId)) {
                const { uri, attachmentText, isNew } = getAttachmentData(word)
                const attachment = { text: attachmentText, uri, isNew, editorId }
                delta.insert({ attachment })
                delta.insert(' ')
            }
        } else if (REGEX_IMAGE.test(word)) {
            if (!inPaste || !checkIsLimitedByTraffic(projectId)) {
                const { uri, resizedUri, imageText, isNew } = getImageData(word)
                const customImageFormat = { text: imageText, uri, resizedUri, isNew, editorId }
                delta.insert({ customImageFormat })
                delta.insert(' ')
            }
        } else if (REGEX_VIDEO.test(word)) {
            if (!inPaste || !checkIsLimitedByTraffic(projectId)) {
                const { uri, videoText, isNew } = getVideoData(word)
                const videoFormat = { text: videoText, uri, isNew, editorId }
                delta.insert({ videoFormat })
                delta.insert(' ')
            }
        } else if (REGEX_HASHTAG.test(word)) {
            const id = v4()
            const hashtag = { text: word.substring(1), id, editorId, userIdAllowedToEditTags }
            delta.insert({ hashtag })
            delta.insert(' ')
        } else if (REGEX_MENTION.test(word)) {
            const { userId, mentionText } = getMentionData(word)
            const id = v4()
            const mention = { text: mentionText, id, userId, editorId, userIdAllowedToEditTags }
            delta.insert({ mention })
            delta.insert(' ')
        } else if (REGEX_EMAIL.test(word)) {
            const emailMatch = word.match(REGEX_EMAIL)
            const id = v4()
            // Create email object with just the email part, no punctuation
            const emailText = emailMatch[1]
            const email = { text: emailText, id, editorId, userIdAllowedToEditTags }
            delta.insert({ email })

            // Add any trailing punctuation as a separate insert
            const punctuation = emailMatch[2]
            if (punctuation) {
                delta.insert(punctuation)
            }
            delta.insert(' ')
        } else if (REGEX_URL.test(word)) {
            let urlToProcess = word
            let trailingPunctuation = ''

            // Check for trailing punctuation
            const urlMatch = word.match(/^(.*?)([\.,;:!?]*?)$/)
            if (urlMatch && urlMatch[2]) {
                const urlPart = urlMatch[1]
                const punctuation = urlMatch[2]

                // Test if the URL part (without punctuation) is a valid URL
                if (REGEX_URL.test(urlPart)) {
                    urlToProcess = urlPart
                    trailingPunctuation = punctuation
                }
            }

            const people = tryToextractPeopleForMention(projectId, urlToProcess)
            if (people) {
                const { peopleName, uid } = people
                const id = v4()
                const mention = { text: peopleName, id, userId: uid, editorId, userIdAllowedToEditTags }
                delta.insert({ mention })
                delta.insert(' ')
            } else {
                const execRes = formatUrl(urlToProcess)
                if (execRes) {
                    const url = getUrlObject(urlToProcess, execRes, projectId, editorId, userIdAllowedToEditTags)

                    const { type, objectId, url: objectUrl } = url
                    if (type === 'task' && inNote) {
                        const taskTagFormat = { id: v4(), taskId: objectId, editorId, objectUrl }
                        delta.insert({
                            taskTagFormat,
                        })
                    } else {
                        delta.insert({
                            url,
                        })
                    }

                    // Add any trailing punctuation
                    if (trailingPunctuation) {
                        delta.insert(trailingPunctuation)
                    }

                    delta.insert(' ')
                }
            }
        } else {
            const parsedWord = index < maxWordIndex ? `${word} ` : word
            delta.insert(parsedWord)
        }
    })

    return delta
}

export const onCopy = (event, editor, projectId, isCuting) => {
    const { index, length } = editor.getSelection()
    const selectedContent = cloneDeep(editor.getContents(index, length))

    let parsedText = ''

    for (let i = 0; i < selectedContent.ops.length; i++) {
        const op = selectedContent.ops[i]
        const { insert } = op

        const {
            mention,
            email,
            url,
            hashtag,
            commentTagFormat,
            attachment,
            customImageFormat,
            videoFormat,
            karma,
            taskTagFormat,
        } = insert

        if (mention) {
            const { text, userId } = mention
            const mentionMetaData =
                userId === NOT_USER_MENTIONED
                    ? `@${text.replaceAll(' ', MENTION_SPACE_CODE).trim()}`
                    : `@${text.replaceAll(' ', MENTION_SPACE_CODE).trim()}#${userId}`
            parsedText += mentionMetaData
            op.insert = mentionMetaData
        } else if (email) {
            const { text } = email
            parsedText += text.trim()
            op.insert = text.trim()
        } else if (hashtag) {
            const { text } = hashtag
            parsedText += `#${text.trim()}`
            op.insert = `#${text.trim()}`
        } else if (url) {
            const { url: link } = url
            parsedText += link.trim()
            op.insert = link.trim()
        } else if (taskTagFormat) {
            const { taskId } = taskTagFormat
            const url = `${window.location.origin}${getDvMainTabLink(projectId, taskId, 'tasks')}`
            parsedText += url
            op.insert = url
        } else if (commentTagFormat) {
            //IMPLEMENT COPY ATTACHMENTS TAGS
            parsedText += 'CommentTag'
            op.insert = 'CommentTag'
        } else if (attachment) {
            const { uri, text, isNew } = attachment
            parsedText += `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${text}${ATTACHMENT_TRIGGER}${isNew}`
            op.insert = `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${text}${ATTACHMENT_TRIGGER}${isNew}`
        } else if (customImageFormat) {
            const { uri, resizedUri, text, isNew } = customImageFormat
            parsedText += `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${resizedUri}${IMAGE_TRIGGER}${text}${IMAGE_TRIGGER}${isNew}`
            op.insert = `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${resizedUri}${IMAGE_TRIGGER}${text}${IMAGE_TRIGGER}${isNew}`
        } else if (videoFormat) {
            const { uri, text, isNew } = videoFormat
            parsedText += `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${text}${VIDEO_TRIGGER}${isNew}`
            op.insert = `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${text}${VIDEO_TRIGGER}${isNew}`
        } else if (karma) {
            const { userId } = karma
            parsedText += `${KARMA_TRIGGER}${userId}`
            op.insert = `${KARMA_TRIGGER}${userId}`
        } else if (typeof insert === 'string') {
            parsedText += insert
        }
    }

    if (isCuting) {
        const selection = document.getSelection()
        selection.deleteFromDocument()
    }

    const tempContainer = document.createElement('div')
    const tempQuill = new Quill(tempContainer)
    tempQuill.setContents(selectedContent)

    const tempQuillContent = tempQuill.getContents()
    var converter = new QuillDeltaToHtmlConverter(tempQuillContent.ops, {})
    var html = converter.convert()

    if (html.length >= 7 && html.substring(0, 3) === `<p>` && html.substring(html.length - 4, html.length) === `</p>`) {
        html = html.substring(3, html.length - 4)
    }
    event.clipboardData.setData('text/html', html)
    event.clipboardData.setData('text/plain', parsedText)
    event.preventDefault()
}

export const beforeUndoRedo = (stack, startAction, endAction) => {
    if (
        stack[startAction].length > 0 &&
        stack[startAction][stack[startAction].length - 1][startAction].type === 'hashtagColor'
    ) {
        const hashtagColorAction = stack[startAction].pop()
        stack[endAction].push(hashtagColorAction)
        const { objectId, text, colorKey } = hashtagColorAction[startAction]
        Backend.updateHastagsColors(objectId, text, colorKey, true)
        return false
    }
}

// Single-line inputs (task names, titles) must never receive line breaks: a programmatic '\n'
// bypasses the Enter keybinding that normally blocks them, so the collapse happens on the text.
export const normalizeDictatedText = (text, singleLine) => {
    const trimmed = typeof text === 'string' ? text.trim() : ''
    return singleLine ? trimmed.replace(/\s+/g, ' ') : trimmed
}

/**
 * Composes the update applied when dictated text lands in an editor: replace the current selection
 * (when there is one) with the processed content, optionally separated from the preceding character
 * by a space. `contentDelta` is the insert-ops delta built by processPastedText(WithBreakLines), so
 * mentions/#hashtags/urls arrive as their blots. Returns the delta plus the caret position after it.
 */
export const buildDictationDelta = ({ Delta, contentDelta, index, length, needsLeadingSpace }) => {
    let delta = new Delta().retain(index)
    if (length > 0) delta = delta.delete(length)
    if (needsLeadingSpace) delta = delta.insert(' ')
    delta = delta.concat(contentDelta)
    const caretIndex = index + (needsLeadingSpace ? 1 : 0) + contentDelta.length()
    return { delta, caretIndex }
}

/**
 * Puts the caret right after dictated text, reliably. A setSelection made synchronously after
 * updateContents/insertText can be overridden by Quill's own scheduled selection reconciliation
 * (the mutation update transforms and restores the pre-insert selection), which leaves the caret
 * before the inserted text. Set it now for the common case, then re-assert it after Quill's update
 * cycle has run. `isEditorStillLive` guards the deferred call against the editor unmounting in the
 * meantime.
 *
 * Returns a canceller for that deferred re-assertion, because it is a FOCUS operation as much as a
 * caret one and the two have opposite requirements (AT-2422). Quill's `setSelection` ends in
 * `Selection.setNativeRange`, which does `if (!this.hasFocus()) this.root.focus()` — so the
 * deferred call cannot merely move a caret, it resurrects focus in an editor that has since been
 * blurred, re-opening the on-screen keyboard. A push-to-talk dictation that submits itself is
 * exactly that case: its host sends and blurs, and this timer then undoes the blur. Cancel it
 * whenever the dictation is going to submit rather than be typed into; see
 * CustomTextInput3.submitDictatedText.
 */
export const placeDictationCaret = (editor, caretIndex, isEditorStillLive) => {
    editor.setSelection(caretIndex, 0, 'user')
    const deferredCaretTimeout = setTimeout(() => {
        if (isEditorStillLive && !isEditorStillLive()) return
        editor.focus()
        editor.setSelection(caretIndex, 0, 'user')
    }, 0)
    return () => clearTimeout(deferredCaretTimeout)
}

export const insertPerplexityContent = (editor, content) => {
    if (!editor) return

    const Delta = editor.constructor.import('delta')
    const delta = new Delta()

    // Process code blocks first
    content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre class="ql-syntax" spellcheck="false" data-language="${lang || ''}">${code.trim()}</pre>`
    })

    // Process inline code
    content = content.replace(/`([^`]+)`/g, (match, code) => {
        return `<code>${code}</code>`
    })

    // Process markdown-style links
    content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        return `<a href="${url}">${text}</a>`
    })

    // Convert the processed HTML to Delta format
    const tempDelta = editor.clipboard.convert({ html: content })

    // Special handling for code blocks to ensure proper formatting
    tempDelta.ops.forEach(op => {
        if (op.insert && typeof op.insert === 'string') {
            // Add any special formatting needed
            if (op.attributes && op.attributes.code) {
                // For inline code
                delta.insert(op.insert, { code: true })
            } else if (op.attributes && op.attributes['code-block']) {
                // For code blocks
                delta.insert(op.insert, { 'code-block': true })
            } else {
                // Regular text
                delta.insert(op.insert, op.attributes || {})
            }
        } else {
            // Non-text content (e.g., images)
            delta.insert(op.insert, op.attributes || {})
        }
    })

    // Insert a newline at the end if needed
    if (!content.endsWith('\n')) {
        delta.insert('\n')
    }

    // Update the editor content
    editor.updateContents(delta, 'user')
}
