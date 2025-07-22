import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../redux/store'
import { exitsOpenModals } from '../ModalsManager/modalsManager'
import { cloneDeep } from 'lodash'
import {
    ATTACHMENT_TRIGGER,
    IMAGE_TRIGGER,
    KARMA_TRIGGER,
    MENTION_SPACE_CODE,
    VIDEO_TRIGGER,
} from '../Feeds/Utils/HelperFunctions'
import { NOT_USER_MENTIONED } from '../Feeds/CommentsTextInput/textInputHelper'
import { getDvMainTabLink } from '../../utils/LinkingHelper'

export const FOLLOWED_NOTES = true
export const ALL_NOTES = false

export const TOLERANCE_FULL_SCREEN_MOBILE = 80
export const TOLERANCE_FULL_SCREEN_TABLET = 120
export const TOLERANCE_FULL_SCREEN_DESKTOP = 160
export const TOLERANCE_NORMAL_SCREEN_MOBILE = 40
export const TOLERANCE_NORMAL_SCREEN_TABLET = 80
export const TOLERANCE_NORMAL_SCREEN_DESKTOP = 120

export const SCROLL_DIRECTION_TO_FULL = 0
export const SCROLL_DIRECTION_TO_NORMAL = 1

export const getScrollTolerance = (toFullScreen = true) => {
    const { smallScreenNavigation: mobile, isMiddleScreen: tablet } = store.getState()
    if (toFullScreen) {
        return mobile
            ? TOLERANCE_FULL_SCREEN_MOBILE
            : tablet
            ? TOLERANCE_FULL_SCREEN_TABLET
            : TOLERANCE_FULL_SCREEN_DESKTOP
    } else {
        return mobile
            ? TOLERANCE_NORMAL_SCREEN_MOBILE
            : tablet
            ? TOLERANCE_NORMAL_SCREEN_TABLET
            : TOLERANCE_NORMAL_SCREEN_DESKTOP
    }
}

export const calcNotesAmount = () => {
    const { selectedProjectIndex: index, notesAmounts } = store.getState()

    if (checkIfSelectedAllProjects(index)) {
        return notesAmounts.reduceRight((a, b) => (a || 0) + (b || 0), 0)
    } else {
        return notesAmounts[index] || 0
    }
}

export const calcNotesAmountByProjectIndex = projectIndex => {
    const { notesAmounts } = store.getState()
    return notesAmounts[projectIndex] || 0
}

export const isPrivateNote = (note, customUser, onlyCheckPrivacy = false) => {
    const { loggedUser } = store.getState()
    const user = customUser || loggedUser
    const userId = customUser?.uid || loggedUser.uid
    return (
        note != null &&
        note.isPrivate &&
        (onlyCheckPrivacy ||
            user.isAnonymous ||
            (note.userId !== userId && (!note.isPublicFor || !note.isPublicFor.includes(userId))))
    )
}

export const isSomeEditOpen = () => {
    const edits = document.querySelectorAll('[data-edit-note]')
    return edits.length > 0 || exitsOpenModals()
}

export const sortNotesFn = (a, b) => {
    if ((a.lastEditionDate || 0) > (b.lastEditionDate || 0)) {
        return -1
    } else if ((a.lastEditionDate || 0) < (b.lastEditionDate || 0)) {
        return 1
    } else if (a.title < b.title) {
        return -1
    } else if (b.title > a.title) {
        return 1
    } else {
        return 0
    }
}

export const getNotePreviewText = (projectId, editor) => {
    const selectedContent = cloneDeep(editor.getContents(0, 500))
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
            parsedText += ' ' + mentionMetaData
        } else if (email) {
            const { text } = email
            parsedText += ' ' + text.trim()
        } else if (hashtag) {
            const { text } = hashtag
            parsedText += ' ' + `#${text.trim()}`
        } else if (url) {
            const { url: link } = url
            parsedText += ' ' + link.trim()
        } else if (taskTagFormat) {
            const { taskId } = taskTagFormat
            const url = `${window.location.origin}${getDvMainTabLink(projectId, taskId, 'tasks')}`
            parsedText += ' ' + url
        } else if (commentTagFormat) {
            //IMPLEMENT COPY ATTACHMENTS TAGS
            parsedText += ' ' + 'CommentTag'
        } else if (attachment) {
            const { uri, text, isNew } = attachment
            parsedText += ' ' + `${ATTACHMENT_TRIGGER}${uri}${ATTACHMENT_TRIGGER}${text}${ATTACHMENT_TRIGGER}${isNew}`
        } else if (customImageFormat) {
            const { uri, resizedUri, text, isNew } = customImageFormat
            parsedText +=
                ' ' +
                `${IMAGE_TRIGGER}${uri}${IMAGE_TRIGGER}${resizedUri}${IMAGE_TRIGGER}${text}${IMAGE_TRIGGER}${isNew}`
        } else if (videoFormat) {
            const { uri, text, isNew } = videoFormat
            parsedText += ' ' + `${VIDEO_TRIGGER}${uri}${VIDEO_TRIGGER}${text}${VIDEO_TRIGGER}${isNew}`
        } else if (karma) {
            const { userId } = karma
            parsedText += ' ' + `${KARMA_TRIGGER}${userId}`
        } else if (typeof insert === 'string') {
            parsedText += ' ' + insert
        }
    }

    return parsedText
}
