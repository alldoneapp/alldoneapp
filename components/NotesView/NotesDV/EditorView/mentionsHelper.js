import v4 from 'uuid/v4'
import ReactQuill from 'react-quill'
import { Dimensions } from 'react-native'

import {
    getElementOffset,
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_RIGHT_MARGIN,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_WIDTH,
    NOT_USER_MENTIONED,
} from '../../../Feeds/CommentsTextInput/textInputHelper'
import store from '../../../../redux/store'
import { formatUrl, getDvMainTabLink, getUrlObject } from '../../../../utils/LinkingHelper'
import { MENTION_SPACE_CODE } from '../../../Feeds/Utils/HelperFunctions'
import { copyContactToProject } from '../../../../utils/backends/Contacts/contactsFirestore'
import { isGlobalAssistant, GLOBAL_PROJECT_ID } from '../../../AdminPanel/Assistants/assistantsHelper'

const Delta = ReactQuill.Quill.import('delta')

export let mentionText = ''
export let showMentionPopup = false
export let selectionBounds = { top: 0, left: 0 }

let activeSelection = { index: 0, length: 0 }
let editorElement = null
let mentionPosition = 0
let noteId = ''
let noteProjectId = ''
let quillRef = null
let mentionModalHeight = 0
let setFlag = null
let flag = false
let quill = null
let quillKeyboardBindingsEnter = null
let quillKeyboardBindingsTab = null
let mentionLastHalfText = ''

export const getSelection = () => {
    return activeSelection
}

export const getQuill = () => {
    return quillRef
}

export const loadQuill = paramQuill => {
    quill = paramQuill
    quillKeyboardBindingsEnter = quill.keyboard.bindings[13]
    quillKeyboardBindingsTab = quill.keyboard.bindings[9]
}

export const loadFlag = paramSetFlag => {
    setFlag = paramSetFlag
}

export const loadMentionsData = (paramNoteId, paramQuillRef, paramProjectId) => {
    noteId = paramNoteId
    noteProjectId = paramProjectId || ''
    quillRef = paramQuillRef
    editorElement = document.getElementsByClassName(`ql-editor-${noteId}`)[0]
    getMentionModalLocation(0)
}

export const resetMentionsData = () => {
    mentionText = ''
    showMentionPopup = false
    updateBindingKeys()
    selectionBounds = { top: 0, left: 0 }
    activeSelection = { index: 0, length: 0 }
    editorElement = null
    mentionPosition = 0
    noteId = ''
    noteProjectId = ''
    quillRef = null
    mentionModalHeight = 0
    flag = false
    quill = null
    quillKeyboardBindingsEnter = null
    quillKeyboardBindingsTab = null
    mentionLastHalfText = ''
}

export const setMentionModalHeight = value => {
    mentionModalHeight = value
    if (mentionModalHeight > 0 && !showMentionPopup) {
        const text = getText()
        getMentionModalLocation(activeSelection.index === 0 ? text.length : activeSelection.index)
    }
}

export const closeMentionPopup = () => {
    if (showMentionPopup) {
        showMentionPopup = false
        updateBindingKeys()
        mentionPosition = 0
        mentionLastHalfText = ''
        mentionText = ''
        updateNotesMentionModalContainer()
    }
}

export const onKeyDownInMentionsModal = event => {
    const { key, ctrlKey } = event

    const text = getText()
    if (key === 'Delete' && mentionLastHalfText && activeSelection.index === text.length - mentionLastHalfText.length) {
        mentionLastHalfText = mentionLastHalfText.substring(1)
    }

    if (showMentionPopup) {
        const isPaste = ctrlKey && (key === 'v' || key === 'V')
        if (isPaste) {
            event.preventDefault()
        }
    }

    if ((key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter') && showMentionPopup) {
        event.preventDefault()
    }
}

const startToMention = cursorIndex => {
    const text = getText()
    showMentionPopup = true
    updateBindingKeys()
    mentionPosition = cursorIndex

    let lastHalfText = text.substring(cursorIndex)
    if (lastHalfText[0] === '&') {
        mentionText = ''
        mentionLastHalfText = lastHalfText
    } else {
        const wordsInLastHalf = lastHalfText.split(/\s|&/)
        mentionText = wordsInLastHalf[0] ? wordsInLastHalf[0] : ''
        const newCursorIndex = cursorIndex + wordsInLastHalf[0].length
        lastHalfText = text.substring(newCursorIndex)
        mentionLastHalfText = lastHalfText
        setTimeout(() => {
            quillRef.current.setSelection(newCursorIndex, 0, 'user')
        })
    }

    updateNotesMentionModalContainer()
}

const updateMentionText = () => {
    if (showMentionPopup) {
        const text = getText()
        mentionText = text.substring(mentionPosition, text.length - mentionLastHalfText.length)
    }
}

const getText = () => {
    if (!quillRef) {
        return ''
    }
    return quillRef.current
        .getContents()
        .map(function (op) {
            if (typeof op.insert === 'string') {
                return op.insert
            } else {
                return '&'
            }
        })
        .join('')
}

export const handleTextChangeForMentions = () => {
    updateMentionText()

    if (!showMentionPopup) {
        const text = getText()
        const lastCharacter = text[activeSelection.index - 1]
        const previousToLastCharacter = text[activeSelection.index - 2]
        const previousPreviousToLastCharacter = text[activeSelection.index - 3]
        const nextCharacter = text[activeSelection.index]

        if (lastCharacter === '@' && (!previousToLastCharacter || previousToLastCharacter.match(/\s|&/))) {
            startToMention(activeSelection.index)
        } else if (nextCharacter === '@' && (!lastCharacter || lastCharacter.match(/\s|&/))) {
            startToMention(activeSelection.index + 1)
        } else if (
            lastCharacter &&
            lastCharacter !== '@' &&
            !lastCharacter.match(/\s|&/) &&
            previousToLastCharacter === '@' &&
            (!previousPreviousToLastCharacter || previousPreviousToLastCharacter.match(/\s|&/))
        ) {
            startToMention(activeSelection.index - 1)
        }
    }
}

const tryToOpenMentionModalBySelection = () => {
    const text = getText()

    const previousCharacter = text[activeSelection.index - 1]
    if (previousCharacter === '@') {
        const previousPreviousCharacter = text[activeSelection.index - 2]
        if (!previousPreviousCharacter || previousPreviousCharacter.match(/\s|&/)) {
            startToMention(activeSelection.index)
        }
    }
}

const checkMentionModalState = () => {
    if (showMentionPopup) {
        const contentLength = quillRef.current.getLength()
        const { index: cursorIndex, length: selectionLength } = activeSelection
        const mentionEndIndex = contentLength - mentionLastHalfText.length
        if (cursorIndex < mentionPosition || cursorIndex + selectionLength > mentionEndIndex) {
            insertNormalMention()
        }
    } else {
        tryToOpenMentionModalBySelection()
    }
}

export const onChangeSelection = selection => {
    if (selection && editorElement) {
        activeSelection = { ...selection }
        if (!showMentionPopup) {
            getMentionModalLocation(activeSelection.index)
        }
        checkMentionModalState()
    }
}

export const insertNormalMention = () => {
    const mentionT = mentionText
    const mentionP = mentionPosition
    closeMentionPopup()
    if (mentionT.trim().length > 0) {
        activeSelection = { index: mentionP - 1, length: 0 }
        const mention = {
            text: mentionT.trim(),
            id: v4(),
            userId: NOT_USER_MENTIONED,
            editorId: noteId,
            userIdAllowedToEditTags: store.getState().loggedUser.uid,
        }
        const delta = new Delta()
        delta.retain(mentionP - 1)
        delta.insert({ mention })
        delta.insert(' ')
        delta.delete(mentionT.length + 1)
        quillRef.current.updateContents(delta, 'user')
    }
}

export const selectItemToMention = async (item, activeTab, projectId) => {
    if (activeTab === MENTION_MODAL_CONTACTS_TAB) {
        if (item.isAssistant) {
            const { uid } = item
            activeSelection = { index: mentionPosition - 1, length: 0 }
            const assistantUrl = `${window.location.origin}${getDvMainTabLink(projectId, uid, 'assistants')}`
            const execRes = formatUrl(assistantUrl)
            if (execRes) {
                const url = getUrlObject(assistantUrl, execRes, projectId, noteId, store.getState().loggedUser.uid)
                const delta = new Delta()
                delta.retain(mentionPosition - 1)
                delta.insert({ url })
                delta.insert(' ')
                delta.delete(mentionText.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        } else {
            // Copy contact to current project if selected from a different project
            let contactUserId = item.uid
            if (item.projectId && noteProjectId && item.projectId !== noteProjectId) {
                const copiedContact = await copyContactToProject(noteProjectId, item)
                if (copiedContact) contactUserId = copiedContact.uid
            }

            const contactName = item.displayName.replaceAll(' ', MENTION_SPACE_CODE)
            activeSelection = { index: mentionPosition - 1, length: 0 }
            const mention = {
                text: contactName,
                id: v4(),
                userId: contactUserId,
                editorId: noteId,
                userIdAllowedToEditTags: store.getState().loggedUser.uid,
            }
            const delta = new Delta()
            delta.retain(mentionPosition - 1)
            delta.insert({ mention })
            delta.insert(' ')
            delta.delete(mentionText.length + 1)
            quillRef.current.updateContents(delta, 'user')
        }
    } else if (activeTab === MENTION_MODAL_TASKS_TAB) {
        if (item.isPreConfigTask) {
            const { id: taskId, assistantId, name: taskName } = item
            const assistantProjectId = isGlobalAssistant(assistantId) ? GLOBAL_PROJECT_ID : projectId
            activeSelection = { index: mentionPosition - 1, length: 0 }

            const preConfigTaskUrl = `${window.location.origin}${getDvMainTabLink(
                projectId,
                taskId,
                'preConfigTasks'
            )}?assistantId=${assistantId}&assistantProjectId=${assistantProjectId}&name=${encodeURIComponent(
                taskName || ''
            )}`

            const execRes = formatUrl(preConfigTaskUrl)
            if (execRes) {
                const url = getUrlObject(preConfigTaskUrl, execRes, projectId, noteId, store.getState().loggedUser.uid)
                const delta = new Delta()
                delta.retain(mentionPosition - 1)
                delta.insert({ url })
                delta.insert(' ')
                delta.delete(mentionText.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        } else {
            const { id } = item
            activeSelection = { index: mentionPosition - 1, length: 0 }
            const taskUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'tasks')}`
            const execRes = formatUrl(taskUrl)
            if (execRes) {
                const url = getUrlObject(taskUrl, execRes, projectId, noteId, store.getState().loggedUser.uid)
                const delta = new Delta()
                delta.retain(mentionPosition - 1)

                const { type, objectId, url: objectUrl } = url
                if (type === 'task') {
                    const taskTagFormat = { id: v4(), taskId: objectId, editorId: noteId, objectUrl }
                    delta.insert({
                        taskTagFormat,
                    })
                } else {
                    delta.insert({
                        url,
                    })
                }

                delta.insert(' ')
                delta.delete(mentionText.length + 1)
                quillRef.current.updateContents(delta, 'user')
            }
        }
    } else if (activeTab === MENTION_MODAL_NOTES_TAB) {
        const { id } = item
        const mentionedNoteProjectId = item.projectId || projectId
        activeSelection = { index: mentionPosition - 1, length: 0 }
        const noteUrl = `${window.location.origin}${getDvMainTabLink(mentionedNoteProjectId, id, 'notes')}`
        const execRes = formatUrl(noteUrl)
        if (execRes) {
            const url = getUrlObject(noteUrl, execRes, mentionedNoteProjectId, noteId, store.getState().loggedUser.uid)
            const delta = new Delta()
            delta.retain(mentionPosition - 1)
            delta.insert({ url })
            delta.insert(' ')
            delta.delete(mentionText.length + 1)
            quillRef.current.updateContents(delta, 'user')
        }
    } else if (activeTab === MENTION_MODAL_TOPICS_TAB) {
        const { id } = item
        activeSelection = { index: mentionPosition - 1, length: 0 }
        const topicUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'chats')}`
        const execRes = formatUrl(topicUrl)
        if (execRes) {
            const url = getUrlObject(topicUrl, execRes, projectId, noteId, store.getState().loggedUser.uid)
            const delta = new Delta()
            delta.retain(mentionPosition - 1)
            delta.insert({ url })
            delta.insert(' ')
            delta.delete(mentionText.length + 1)
            quillRef.current.updateContents(delta, 'user')
        }
    } else if (activeTab === MENTION_MODAL_GOALS_TAB) {
        const { id } = item
        activeSelection = { index: mentionPosition - 1, length: 0 }
        const goalUrl = `${window.location.origin}${getDvMainTabLink(projectId, id, 'goals')}`
        const execRes = formatUrl(goalUrl)
        if (execRes) {
            const url = getUrlObject(goalUrl, execRes, projectId, noteId, store.getState().loggedUser.uid)
            const delta = new Delta()
            delta.retain(mentionPosition - 1)
            delta.insert({ url })
            delta.insert(' ')
            delta.delete(mentionText.length + 1)
            quillRef.current.updateContents(delta, 'user')
        }
    }
    closeMentionPopup()
}

const updateBindingKeys = () => {
    if (quill?.keyboard) {
        if (showMentionPopup) {
            delete quill.keyboard.bindings[13]
            delete quill.keyboard.bindings[9]
        } else {
            quill.keyboard.bindings[13] = quillKeyboardBindingsEnter
            quill.keyboard.bindings[9] = quillKeyboardBindingsTab
        }
    }
}

const updateNotesMentionModalContainer = () => {
    if (setFlag) {
        setFlag(!flag)
        flag = !flag
    }
}

const getMentionModalLocation = selectionIndex => {
    const mentionModalParentOffset = getElementOffset(document.body)
    const editorOffset = getElementOffset(editorElement)
    const { bottom, left } = quillRef.current.getBounds(selectionIndex)

    const windowWidth = Dimensions.get('window').width
    const windowHeight = Dimensions.get('window').height

    const bounds = {
        left: left + (editorOffset.left - mentionModalParentOffset.left),
        top: bottom + (editorOffset.top - mentionModalParentOffset.top),
    }

    const rightBoundary = windowWidth - MENTION_MODAL_WIDTH - MENTION_MODAL_RIGHT_MARGIN
    const bottomBoundary = windowHeight - mentionModalHeight - MENTION_MODAL_RIGHT_MARGIN
    if (bounds.left + mentionModalParentOffset.left > rightBoundary) {
        bounds.left = rightBoundary - mentionModalParentOffset.left
    }

    if (bounds.top + mentionModalParentOffset.top > bottomBoundary) {
        bounds.top = bottomBoundary - mentionModalParentOffset.top
    }
    const spaceBetweenCursorAndModalLeft = 5
    const spaceBetweenCursorAndModalTopAdjustment = 20
    bounds.left += spaceBetweenCursorAndModalLeft
    bounds.top -= spaceBetweenCursorAndModalTopAdjustment
    selectionBounds = bounds
}
