import v4 from 'uuid/v4'
import ReactQuill from 'react-quill-new'
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
import { findMentionEnd, findMentionStart, readCursorText } from './noteCursorText'
import { captureNoteSelectionSnapshot, clearNoteSelectionSnapshot, normalizeSelection } from './noteSelection'

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
let mentionEnd = 0
let selectionTimeout = null

export const getSelection = () => {
    return activeSelection
}

/**
 * Snapshots the editor's current selection at the moment a toolbar action is
 * pressed.
 *
 * Two things are written: the shared cache (what everything else reads), and a
 * single-use press-time snapshot that the create-task popup consumes. The
 * snapshot is what makes "select text, press Task" reliable - by the time the
 * popup is constructed the note editor may no longer be able to report the
 * range at all, and Quill's `savedRange` cannot be trusted to stand in for it
 * because it defaults to `{index: 0, length: 0}` rather than to "unknown".
 *
 * Returns the resolved selection.
 */
export const captureSelectionFromEditor = editor => {
    activeSelection = captureNoteSelectionSnapshot(editor, activeSelection)
    return activeSelection
}

export const getQuill = () => {
    return quillRef
}

export const loadQuill = paramQuill => {
    quill = paramQuill
    quillKeyboardBindingsEnter = quill.keyboard.bindings['Enter']
    quillKeyboardBindingsTab = quill.keyboard.bindings['Tab']
}

export const loadFlag = paramSetFlag => {
    setFlag = paramSetFlag
}

export const loadMentionsData = (paramNoteId, paramQuillRef, paramProjectId) => {
    noteId = paramNoteId
    noteProjectId = paramProjectId || ''
    quillRef = paramQuillRef
    editorElement = document.getElementsByClassName(`ql-editor-${noteId}`)[0]
}

export const resetMentionsData = () => {
    mentionText = ''
    showMentionPopup = false
    updateBindingKeys()
    selectionBounds = { top: 0, left: 0 }
    activeSelection = { index: 0, length: 0 }
    clearNoteSelectionSnapshot()
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
    mentionEnd = 0
    clearTimeout(selectionTimeout)
}

export const setMentionModalHeight = value => {
    mentionModalHeight = value
    if (mentionModalHeight > 0 && showMentionPopup) {
        getMentionModalLocation(activeSelection.index)
    }
}

export const closeMentionPopup = () => {
    if (showMentionPopup) {
        showMentionPopup = false
        updateBindingKeys()
        mentionPosition = 0
        mentionEnd = 0
        clearTimeout(selectionTimeout)
        mentionText = ''
        updateNotesMentionModalContainer()
    }
}

export const onKeyDownInMentionsModal = event => {
    const { key, ctrlKey } = event

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
    const editor = quillRef?.current
    if (!editor) return
    showMentionPopup = true
    updateBindingKeys()
    mentionPosition = cursorIndex
    mentionEnd = findMentionEnd(editor, cursorIndex)
    mentionText = readCursorText(editor, mentionPosition, mentionEnd - mentionPosition)
    getMentionModalLocation(cursorIndex)
    if (mentionEnd > cursorIndex) {
        const currentEditor = editor
        selectionTimeout = setTimeout(() => {
            if (quillRef?.current === currentEditor && showMentionPopup) {
                currentEditor.setSelection(mentionEnd, 0, 'user')
            }
        })
    }
    updateNotesMentionModalContainer()
}

export const handleTextChangeForMentions = delta => {
    const editor = quillRef?.current
    if (!editor) return
    if (showMentionPopup) {
        // Transform the range, not a saved copy of everything after it. Remote
        // edits before the mention and Delete at its end work the same way.
        if (delta) {
            const change = new Delta(delta.ops)
            mentionPosition = change.transformPosition(mentionPosition, true)
            mentionEnd = change.transformPosition(mentionEnd, false)
        }
        if (readCursorText(editor, mentionPosition - 1, 1) !== '@') return closeMentionPopup()
        const nextText = readCursorText(editor, mentionPosition, mentionEnd - mentionPosition)
        if (nextText !== mentionText) {
            mentionText = nextText
            updateNotesMentionModalContainer()
        }
    } else {
        const start = findMentionStart(editor, activeSelection.index)
        if (start !== null) startToMention(start)
    }
}

const tryToOpenMentionModalBySelection = () => {
    const editor = quillRef?.current
    if (!editor) return
    const previous = readCursorText(editor, Math.max(0, activeSelection.index - 2), Math.min(2, activeSelection.index))
    if (previous.endsWith('@') && (previous.length === 1 || /\s|&/.test(previous[0]))) {
        startToMention(activeSelection.index)
    }
}

const checkMentionModalState = () => {
    if (showMentionPopup) {
        const { index: cursorIndex, length: selectionLength } = activeSelection
        if (cursorIndex < mentionPosition || cursorIndex + selectionLength > mentionEnd) {
            insertNormalMention()
        }
    } else {
        tryToOpenMentionModalBySelection()
    }
}

export const onChangeSelection = selection => {
    const normalizedSelection = normalizeSelection(selection)
    if (!normalizedSelection) return

    // Track the selection even before `loadMentionsData` has resolved the
    // editor's DOM node. `editorElement` only gates the mention popup's
    // positioning; gating the cache on it too meant that a note whose element
    // lookup had not landed yet kept reporting {index: 0, length: 0} to every
    // toolbar action - the create-task popup included.
    activeSelection = normalizedSelection

    if (!editorElement) return

    checkMentionModalState()
    if (showMentionPopup) getMentionModalLocation(activeSelection.index)
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
            delete quill.keyboard.bindings['Enter']
            delete quill.keyboard.bindings['Tab']
        } else {
            quill.keyboard.bindings['Enter'] = quillKeyboardBindingsEnter
            quill.keyboard.bindings['Tab'] = quillKeyboardBindingsTab
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
    const { bottom, left } = quillRef.current.getBounds(selectionIndex) || { bottom: 0, left: 0 }

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
