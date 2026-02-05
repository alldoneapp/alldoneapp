import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { firebase } from '@firebase/app'
import moment from 'moment'
import v4 from 'uuid/v4'
import Hotkeys from 'react-hot-keys'
import ReactQuill from 'react-quill'
import { QuillBinding } from 'y-quill'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

import EditorToolbar, {
    BoldIcon,
    CleanFormat,
    closeColorPopup,
    closeHeadingPopup,
    CrossoutIcon,
    DecreaseIndent,
    File,
    formats,
    HighlightColor,
    IncreaseIndent,
    ItalicsIcon,
    Link,
    ListBulleted,
    ListNumbered,
    modules,
    openColorPopup,
    openHeadingPopup,
    TextColor,
    UnderlineIcon,
} from './EditorToolbar'
import './toolbar-styles.css'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import Backend from '../../../../utils/BackendBridge'
import URLsNotes, { URL_NOTE_DETAILS_EDITOR } from '../../../../URLSystem/Notes/URLsNotes'
import { getRandomCollabColor } from '../../../styles/global'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import {
    resetLoadingData,
    setQuillEditorProjectId,
    showConfirmPopup,
    setIsLoadingNoteData,
    setNoteEditorScrollDimensions,
    setShowNoteMaxLengthModal,
    setQuillTextInputProjectIdsByEditorId,
} from '../../../../redux/actions'
import {
    getDvMainTabLink,
    isValidAssistantLink,
    isValidContactLink,
    isValidGoalLink,
    isValidNoteLink,
    isValidProjectLink,
    isValidSkillLink,
    isValidTaskLink,
} from '../../../../utils/LinkingHelper'
import SharedHelper from '../../../../utils/SharedHelper'
import {
    cleanTagsInteractionsPopus,
    createPlaceholder,
    LOADING_MODE,
    NEW_ATTACHMENT,
    NOT_USER_MENTIONED,
    onCopy,
    processPastedTextWithBreakLines,
    QUILL_EDITOR_NOTE_TYPE,
} from '../../../Feeds/CommentsTextInput/textInputHelper'
import { MANAGE_TASK_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { DV_TAB_NOTE_EDITOR } from '../../../../utils/TabNavigationConstants'
import {
    getSelection,
    handleTextChangeForMentions,
    loadMentionsData,
    onChangeSelection,
    onKeyDownInMentionsModal,
    resetMentionsData,
} from './mentionsHelper'
import { getNotePreviewText, getScrollTolerance } from '../../NotesHelper'
import { markdownToDelta, containsMarkdown } from './markdownToDelta'
import { updateNewAttachmentsDataInNotes } from '../../../Feeds/Utils/HelperFunctions'
import { getDateFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import { BACKGROUND_COLORS, TEXT_COLORS } from '../../../../utils/ColorConstants'
import { CONFIRM_POPUP_TIMEOUT } from '../../../UIComponents/ConfirmPopup'
import { quillTextInputProjectIds } from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'
import { updateXpByEditingNote } from '../../../../utils/Levels'
import { getDb, getNotesCollaborationServerData } from '../../../../utils/backends/firestore'
import { setNoteData } from '../../../../utils/backends/Notes/notesFirestore'

const Delta = ReactQuill.Quill.import('delta')

const icons = ReactQuill.Quill.import('ui/icons')
icons['bold'] = BoldIcon
icons['underline'] = UnderlineIcon
icons['italic'] = ItalicsIcon
icons['strike'] = CrossoutIcon
icons['color'] = TextColor
icons['background'] = HighlightColor
icons['clean'] = CleanFormat
icons['link'] = Link
icons['list'] = { bullet: ListBulleted, ordered: ListNumbered }
icons['image'] = File
icons['indent'] = { '+1': IncreaseIndent, '-1': DecreaseIndent }

export let exportRef = null
export let exportLoadingRef = null
export let loadedNote = null
const SAVE_INTERVAL = 3000

const NotesEditorView = ({
    project,
    note,
    isFullscreen,
    setFullscreen,
    followState,
    readOnly,
    connectionState,
    objectType,
    objectId,
    object,
    autoStartTranscription,
}) => {
    const projectId = project ? project.id : undefined
    let quillRef = useRef(null)
    let reactQuillRef = useRef(null).current
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const showNewDayNotification = useSelector(state => state.showNewDayNotification)
    const showNewVersionMandtoryNotifcation = useSelector(state => state.showNewVersionMandtoryNotifcation)
    const loggedUser = useSelector(state => state.loggedUser)
    const isLoadingNoteData = useSelector(state => state.isLoadingNoteData)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const userName = loggedUser.displayName
    const selectedTab = useSelector(state => state.selectedNavItem)
    const isLoadingData = useSelector(state => state.isLoadingData)
    const [state, setState] = useState({ value: null })
    const [synced, setSynced] = useState(false)
    const [editors, setEditors] = useState([])
    const [dataLoaded, setDataLoaded] = useState(false)
    // const [scrollEnabled, setScrollEnabled] = useState(false)
    const firstEditionRef = useRef(true)
    let loadingRef = useRef(true)
    let provider = useRef(null)
    let ydoc = useRef(null)
    let binding = useRef(null)
    let dirtyEditor = useRef(false)
    let saveTimeoutHandle = useRef(null)
    const initialUserMentionsIdsRef = useRef({})
    const color = useRef(getRandomCollabColor())
    const dispatch = useDispatch()
    const isInitialRefs = useRef(true)
    const noteUnmountedRef = useRef(false)
    exportLoadingRef = loadingRef.current
    const scrollbarGone = useRef(null)
    const scrollRef = useRef()
    const scrollYPos = useRef(0)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const needReplaceImageFormat = useRef(false)
    const readOnlyRef = useRef(readOnly)
    const timeoutRef = useRef(null)
    const timeoutModalIsOpen = useRef(false)
    const maxLengthWarningDisplayed = useRef(false)
    const innerTasksIdsRef = useRef([])

    const lastFullscreenChangeTime = useRef(0)
    const pendingFullscreenChange = useRef(null)
    const isFullscreenRef = useRef(isFullscreen)
    isFullscreenRef.current = isFullscreen

    const updateScreenMode = deltaY => {
        scrollYPos.current = deltaY
        const now = Date.now()
        const DEBOUNCE_MS = 150

        const shouldGoFullscreen = deltaY > getScrollTolerance(true) && !isFullscreenRef.current
        const shouldExitFullscreen = deltaY < getScrollTolerance(false) && isFullscreenRef.current

        if (shouldGoFullscreen || shouldExitFullscreen) {
            const timeSinceLastChange = now - lastFullscreenChangeTime.current

            if (timeSinceLastChange < DEBOUNCE_MS) {
                if (pendingFullscreenChange.current) {
                    clearTimeout(pendingFullscreenChange.current)
                }
                pendingFullscreenChange.current = setTimeout(() => {
                    const currentY = scrollYPos.current
                    if (currentY > getScrollTolerance(true) && !isFullscreenRef.current) {
                        lastFullscreenChangeTime.current = Date.now()
                        setFullscreen(true)
                    } else if (currentY < getScrollTolerance(false) && isFullscreenRef.current) {
                        lastFullscreenChangeTime.current = Date.now()
                        setFullscreen(false)
                    }
                    pendingFullscreenChange.current = null
                }, DEBOUNCE_MS - timeSinceLastChange)
                return
            }

            lastFullscreenChangeTime.current = now
            if (shouldGoFullscreen) {
                setFullscreen(true)
            } else {
                setFullscreen(false)
            }
        }
    }

    const switchScreenModes = value => {
        if (blockShortcuts) {
            return
        }
        if (!value) {
            scrollRef.current.scrollTo({ x: 0, y: 0, animated: false })
        }
        setFullscreen(value)
    }

    const AddUserAsFollower = () => {
        if (!followState) {
            const followData = {
                followObjectsType: objectType,
                followObjectId: objectId,
                followObject: object,
                feedCreator: loggedUser,
            }
            Backend.tryAddFollower(projectId, followData)
        }
    }

    const scanLinkedObjects = () => {
        const ops = quillRef.current.getContents().ops
        const linkedParentNotesUrl = []
        const linkedParentTasksUrl = []
        const linkedParentContactsUrl = []
        const linkedParentProjectsUrl = []
        const linkedParentGoalsUrl = []
        const linkedParentSkillsUrl = []
        const linkedParentAssistantsUrl = []
        for (let op of ops) {
            if (op.insert) {
                const { url, mention, taskTagFormat } = op.insert
                if (mention) {
                    if (mention.userId !== NOT_USER_MENTIONED) {
                        const objectType = TasksHelper.getPeopleTypeUsingId(mention.userId, projectId)
                        const contactUrl = `${window.origin}${getDvMainTabLink(projectId, mention.userId, objectType)}`
                        if (linkedParentContactsUrl.indexOf(contactUrl) < 0) {
                            linkedParentContactsUrl.push(contactUrl)
                        }
                    }
                } else if (taskTagFormat) {
                    const taskUrl = `${window.origin}${getDvMainTabLink(projectId, taskTagFormat.taskId, 'tasks')}`
                    if (linkedParentTasksUrl.indexOf(taskUrl) < 0) {
                        linkedParentTasksUrl.push(taskUrl)
                    }
                } else if (url) {
                    if (isValidNoteLink(op.insert.url.url, projectId)) {
                        linkedParentNotesUrl.push(op.insert.url.url)
                    } else if (isValidTaskLink(op.insert.url.url, projectId)) {
                        linkedParentTasksUrl.push(op.insert.url.url)
                    } else if (isValidContactLink(op.insert.url.url, projectId)) {
                        linkedParentContactsUrl.push(op.insert.url.url)
                    } else if (isValidProjectLink(op.insert.url.url, projectId)) {
                        linkedParentProjectsUrl.push(op.insert.url.url)
                    } else if (isValidGoalLink(op.insert.url.url, projectId)) {
                        linkedParentGoalsUrl.push(op.insert.url.url)
                    } else if (isValidSkillLink(op.insert.url.url, projectId)) {
                        linkedParentSkillsUrl.push(op.insert.url.url)
                    } else if (isValidAssistantLink(op.insert.url.url, projectId)) {
                        linkedParentAssistantsUrl.push(op.insert.url.url)
                    }
                }
            }
        }
        Backend.setLinkedParentObjects(
            projectId,
            {
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            },
            {
                type: 'note',
                id: note.id,
                secondaryParentsIds: note.linkedParentsInTitleIds,
                notePartEdited: 'content',
                isUpdatingNotes: true,
            },
            {}
        )
    }

    const checkMaxLength = () => {
        const text = quillRef.current.getText()
        const MAX_LENGTH_IN_KB = 100
        const byteSize = str => new Blob([str]).size
        const size = byteSize(text) / 1024
        if (size > MAX_LENGTH_IN_KB && !maxLengthWarningDisplayed.current) {
            maxLengthWarningDisplayed.current = true
            dispatch(setShowNoteMaxLengthModal(true))
        } else if (size < MAX_LENGTH_IN_KB && maxLengthWarningDisplayed.current) {
            maxLengthWarningDisplayed.current = false
        }
    }

    const autosave = () => {
        clearTimeout(saveTimeoutHandle.current)
        saveTimeoutHandle.current = null
        if (dirtyEditor.current) {
            dirtyEditor.current = false

            const stateUpdate = Y.encodeStateAsUpdate(ydoc.current)
            const preview = getNotePreviewText(projectId, quillRef.current)
            scanLinkedObjects()
            checkMaxLength()
            setNoteData(projectId, note.id, stateUpdate, preview, firstEditionRef, accessGranted)
            // Commenting this by Customer request
            // Backend.logEvent('ending_editing_note', {
            //     uid: loggedUser.uid,
            //     id: note.id,
            // })
            AddUserAsFollower()
        }
    }

    const checkIfNeedReplaceFormats = changesOps => {
        for (let i = 0; i < changesOps.length; i++) {
            const { insert } = changesOps[i]
            if (insert) {
                const { image } = insert
                if (image) {
                    needReplaceImageFormat.current = true
                }
            }
        }
    }

    const checkForInnerTasksChanges = (changesOps, source) => {
        let checkForDeletedTasks = false
        for (let i = 0; i < changesOps.length; i++) {
            const { insert, delete: remove } = changesOps[i]
            if (insert) {
                const { taskTagFormat } = insert
                if (taskTagFormat) {
                    const { taskId } = taskTagFormat
                    if (!innerTasksIdsRef.current.includes(taskId)) innerTasksIdsRef.current.push(taskId)
                    if (source === 'user') {
                        Backend.setTaskContainerNotesIds(projectId, taskId, note.id, 'add', false)
                    }
                }
            }
            if (remove) checkForDeletedTasks = true
        }
        if (checkForDeletedTasks && innerTasksIdsRef.current.length > 0) {
            const deltaContent = quillRef.current.getContents()
            const currentTasksIds = []
            for (let i = 0; i < deltaContent.ops.length; i++) {
                const { insert } = deltaContent.ops[i]
                if (insert) {
                    const { taskTagFormat } = insert
                    if (taskTagFormat) {
                        const { taskId } = taskTagFormat
                        if (!currentTasksIds.includes(taskId)) currentTasksIds.push(taskId)
                    }
                }
            }

            if (source === 'user') {
                const deletedTasksIds = innerTasksIdsRef.current.filter(taskId => !currentTasksIds.includes(taskId))
                deletedTasksIds.forEach(taskId => {
                    Backend.setTaskContainerNotesIds(projectId, taskId, note.id, 'remove', true)
                })
            }

            innerTasksIdsRef.current = currentTasksIds
        }
    }

    const handleChange = (value, delta, source) => {
        handleTextChangeForMentions()
        if (dataLoaded) {
            dirtyEditor.current = true
            if (saveTimeoutHandle.current === null) {
                // Commenting this by Customer request
                // Backend.logEvent('started_editing_note', {
                //     uid: loggedUser.uid,
                //     id: note.id,
                // })
                saveTimeoutHandle.current = setTimeout(autosave, SAVE_INTERVAL)
            }
        }
        checkForInnerTasksChanges(delta.ops, source)
        checkIfNeedReplaceFormats(delta.ops)
        setState({ value })

        resetTimeoutCounter()
    }

    const resetTimeoutCounter = () => {
        const ONE_HOUR = 10800000

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
        if (!showNewDayNotification && !showNewVersionMandtoryNotifcation) {
            timeoutRef.current = setTimeout(() => {
                quillRef.current.blur()
                timeoutModalIsOpen.current = true
                disconnectFromServer()
                dispatch(showConfirmPopup({ trigger: CONFIRM_POPUP_TIMEOUT, object: {} }))
            }, ONE_HOUR)
        }
    }

    useEffect(() => {
        updateXpByEditingNote(loggedUser.uid, firebase, getDb(), projectId)
    }, [])

    useEffect(() => {
        resetTimeoutCounter()
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
        }
    }, [])

    useEffect(() => {
        return () => {
            noteUnmountedRef.current = true
        }
    }, [])

    useEffect(() => {
        return () => {
            if (pendingFullscreenChange.current) {
                clearTimeout(pendingFullscreenChange.current)
            }
        }
    }, [])

    useEffect(() => {
        dispatch(setQuillTextInputProjectIdsByEditorId(note.id, projectId))
        quillTextInputProjectIds[note.id] = projectId
        return () => {
            dispatch(setQuillTextInputProjectIdsByEditorId(note.id, ''))
            delete quillTextInputProjectIds[note.id]
        }
    }, [note.id])

    useEffect(() => {
        return () => {
            if (quillRef.current && typeof quillRef.current.getContents === 'function') {
                const deltaContent = quillRef.current.getContents()
                for (let i = 0; i < deltaContent.ops.length; i++) {
                    const { hashtag } = deltaContent.ops[i].insert
                    if (hashtag) {
                        Backend.unwatchHastagsColors(hashtag.id)
                    }
                }
            }
        }
    }, [])

    const replaceQuillImagesByCustomImagesFormat = () => {
        needReplaceImageFormat.current = false
        const editor = exportRef.getEditor()
        const ops = editor.getContents().ops
        let inputCursorIndex = getSelection().index

        for (let i = 0; i < ops.length; i++) {
            const { image } = ops[i].insert
            if (image) {
                if (checkIsLimitedByTraffic(projectId)) {
                    delete ops[i]
                    inputCursorIndex -= 1
                } else {
                    const id = v4()
                    const text = 'image.jpg'
                    const customImageFormat = {
                        text,
                        uri: image,
                        resizedUri: image,
                        isNew: NEW_ATTACHMENT,
                        isLoading: LOADING_MODE,
                        id,
                        editorId: note.id,
                    }

                    delete ops[i].insert.image
                    delete ops[i].insert.attributes
                    ops[i].insert.customImageFormat = customImageFormat
                    ops.splice(i + 1, 0, { insert: ' ' })
                    ops.splice(i, 0, { insert: ' ' })
                    inputCursorIndex += 2

                    updateNewAttachmentsDataInNotes(editor, id, text, image)
                }
            }
        }

        editor.setContents(ops)
        editor.setSelection(inputCursorIndex, 0)
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_NOTE_EDITOR) {
            const data = { note: note.id }
            data.projectId = projectId
            URLsNotes.push(URL_NOTE_DETAILS_EDITOR, data, projectId, note.id, note.title)
        }
    }

    const cleanup = () => {
        const ops = quillRef.current.getContents().ops
        generateMentionTasks(ops)
        resetMentionsData()
        document.removeEventListener('keydown', onKeyDownInMentionsModal)
        cleanTagsInteractionsPopus()
        Backend.logEvent('exiting_note', {
            uid: loggedUser.uid,
            id: note.id,
        })
        Backend.removeNoteEditor(note.id, { id: loggedUser.uid, color: color.current })
        dispatch([resetLoadingData(), setIsLoadingNoteData(false)])
        clearTimeout(saveTimeoutHandle.current)
        saveTimeoutHandle.current = null

        if (!loadingRef.current && dirtyEditor.current) {
            const stateUpdate = Y.encodeStateAsUpdate(ydoc.current)
            scanLinkedObjects()
            setNoteData(projectId, note.id, stateUpdate, quillRef.current.getText(0, 500), firstEditionRef, true)
        }

        if (provider.current) {
            //provider.current.disconnect()
            provider.current.destroy()
        }
        if (ydoc.current) {
            ydoc.current.destroy()
        }
        if (binding.current) {
            binding.current.destroy()
        }

        removeModal(MANAGE_TASK_MODAL_ID)
    }

    useEffect(() => {
        if ((showNewDayNotification || showNewVersionMandtoryNotifcation) && timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
    }, [showNewDayNotification, showNewVersionMandtoryNotifcation])

    useEffect(() => {
        if (needReplaceImageFormat.current) {
            replaceQuillImagesByCustomImagesFormat()
        }
    }, [state])

    useEffect(() => {
        dispatch(resetLoadingData())
        return () => {
            dispatch(setNoteEditorScrollDimensions(0, 0))
        }
    }, [])
    useEffect(() => {
        readOnlyRef.current = readOnly
    }, [readOnly])

    useEffect(() => {
        attachQuillRefs()

        const containerElement = document.getElementsByClassName(`ql-container-${note.id}`)[0]
        containerElement.classList.add('ql-note-editor-mobile')

        const editorElement = document.getElementsByClassName(`ql-editor-${note.id}`)[0]
        editorElement.addEventListener('copy', event => {
            onCopy(event, exportRef.getEditor(), projectId, false)
        })

        editorElement.addEventListener('cut', event => {
            onCopy(event, exportRef.getEditor(), projectId, !readOnlyRef.current)
        })

        editorElement.addEventListener('paste', event => {
            if (!readOnlyRef.current) {
                const textData = (event.clipboardData || window.clipboardData).getData('text')
                const htmlData = (event.clipboardData || window.clipboardData).getData('text/html')

                console.log('[NotesEditorView PASTE] ========== START ==========')
                console.log('[NotesEditorView PASTE] Raw text data:', JSON.stringify(textData))
                console.log('[NotesEditorView PASTE] Has HTML data:', !!htmlData)
                console.log('[NotesEditorView PASTE] Contains markdown:', textData ? containsMarkdown(textData) : false)

                // Check if plain text contains markdown - if so, prioritize markdown conversion
                if (textData && containsMarkdown(textData)) {
                    console.log('[NotesEditorView PASTE] Processing as markdown...')
                    const parsedDelta = markdownToDelta(textData, Delta)

                    if (parsedDelta) {
                        const editor = exportRef.getEditor()
                        const selection = editor.getSelection(true)
                        console.log('[NotesEditorView PASTE] Selection:', JSON.stringify(selection))

                        if (selection.length > 0) {
                            parsedDelta.ops.unshift({ delete: selection.length })
                        }
                        if (selection.index > 0) {
                            parsedDelta.ops.unshift({ retain: selection.index })
                        }

                        console.log(
                            '[NotesEditorView PASTE] Final delta to apply:',
                            JSON.stringify(parsedDelta.ops, null, 2)
                        )

                        const previousLenght = editor.getLength()
                        editor.updateContents(parsedDelta, 'user')
                        const newLenght = editor.getLength()
                        editor.setSelection(selection.index + newLenght - previousLenght + selection.length, 0, 'user')

                        console.log(
                            '[NotesEditorView PASTE] Applied markdown delta, length changed from',
                            previousLenght,
                            'to',
                            newLenght
                        )
                        console.log('[NotesEditorView PASTE] ========== END ==========')

                        event.preventDefault()
                        return
                    }
                }

                // Fall back to HTML processing if available
                if (htmlData) {
                    const pastedDelta = exportRef.getEditor().clipboard.convert(htmlData)
                    const finalDelta = { ops: [] }

                    for (let i = 0; i < pastedDelta.ops.length; i++) {
                        const op = pastedDelta.ops[i]
                        const { retain, insert, attributes } = op
                        if (retain || op.delete) {
                            finalDelta.ops.push(op)
                        } else if (insert) {
                            if (typeof insert === 'string' && insert !== '') {
                                const delta = processPastedTextWithBreakLines(
                                    insert,
                                    Delta,
                                    projectId,
                                    note.id,
                                    null,
                                    false,
                                    '',
                                    exportRef.getEditor(),
                                    true,
                                    attributes,
                                    true
                                )
                                finalDelta.ops = [...finalDelta.ops, ...delta.ops]
                            } else {
                                finalDelta.ops.push(op)
                            }
                        }
                    }

                    const editor = exportRef.getEditor()
                    const selection = editor.getSelection(true)

                    if (selection.length > 0) {
                        finalDelta.ops.unshift({ delete: selection.length })
                    }
                    if (selection.index > 0) {
                        finalDelta.ops.unshift({ retain: selection.index })
                    }

                    const previousLenght = editor.getLength()
                    editor.updateContents(finalDelta, 'user')
                    const newLenght = editor.getLength()
                    editor.setSelection(selection.index + newLenght - previousLenght + selection.length, 0, 'user')

                    event.preventDefault()
                } else if (textData) {
                    // Plain text paste without HTML (markdown already handled above)
                    const parsedDelta = processPastedTextWithBreakLines(
                        textData,
                        Delta,
                        projectId,
                        note.id,
                        null,
                        false,
                        '',
                        exportRef.getEditor(),
                        true,
                        null,
                        true
                    )

                    const editor = exportRef.getEditor()
                    const selection = editor.getSelection(true)

                    if (selection.length > 0) {
                        parsedDelta.ops.unshift({ delete: selection.length })
                    }
                    if (selection.index > 0) {
                        parsedDelta.ops.unshift({ retain: selection.index })
                    }

                    const previousLenght = editor.getLength()
                    editor.updateContents(parsedDelta, 'user')
                    const newLenght = editor.getLength()
                    editor.setSelection(selection.index + newLenght - previousLenght + selection.length, 0, 'user')

                    event.preventDefault()
                }
            }
        })
    }, [])

    useEffect(() => {
        dispatch([setIsLoadingNoteData(true)])
        quillRef.current.blur()

        loadedNote = note
        dispatch(setQuillEditorProjectId(projectId))
        writeBrowserURL()

        document.addEventListener('keydown', onKeyDownInMentionsModal)
        window.onbeforeunload = () => {
            cleanup()
            return null
        }

        Backend.addNoteEditor(note.id, { id: loggedUser.uid, color: color.current })
        Backend.watchNotesCollab(note.id, editors => {
            if (editors) {
                setEditors(editors.editors)
            }
        })

        ydoc.current = new Y.Doc()
        const type = ydoc.current.getText('quill')
        Backend.getNoteData(projectId, note.id).then(data => {
            dispatch([resetLoadingData(), setIsLoadingNoteData(false)])
            if (!noteUnmountedRef.current) {
                const update = new Uint8Array(data)
                if (update.length > 0) {
                    Y.applyUpdate(ydoc.current, update)
                }

                provider.current = new WebsocketProvider(
                    getNotesCollaborationServerData().NOTES_COLLABORATION_SERVER,
                    note.id,
                    ydoc.current
                )
                /*provider.current = new WebrtcProvider(note.id, ydoc.current, {
                        peerOpts: { config },
                        signaling: signalingServers,
                    })*/
                provider.current.on('synced', synced => {
                    setSynced(true)
                })
                provider.current.awareness.setLocalStateField('user', {
                    name: userName,
                    color: color.current,
                })
                binding.current = new QuillBinding(type, quillRef.current, provider.current.awareness)

                loadingRef.current = false
                exportLoadingRef = false
                quillRef.current.focus()
                quillRef.current.setSelection(0, 0)

                const ops = quillRef.current.getContents().ops

                storeInitialUserMentions(ops)
                setDataLoaded(true)

                loadMentionsData(note.id, quillRef, projectId)

                const editorElement = document.getElementsByClassName(`ql-editor-${note.id}`)[0]
                editorElement?.classList?.add('ql-editorLoading')

                if (readOnly) {
                    const commentElements = document.getElementsByClassName(`ql-comment`)
                    for (let i = 0; i < commentElements.length; i++) {
                        const comment = commentElements[i]
                        comment.setAttribute('contenteditable', 'false')
                    }
                }
                checkMaxLength()
            }
        })
        return cleanup
    }, [])

    useEffect(() => {
        const commentElements = document.getElementsByClassName(`ql-comment`)
        for (let i = 0; i < commentElements.length; i++) {
            const comment = commentElements[i]
            comment.setAttribute('contenteditable', readOnly ? 'false' : 'true')
        }
    }, [readOnly])

    useEffect(() => {
        const editorElement = document.getElementsByClassName(`ql-editor-${note.id}`)[0]
        if (!mobile && mobileCollapsed) {
            editorElement?.classList?.add('ql-editor-collapsed')
        } else {
            editorElement?.classList?.remove('ql-editor-collapsed')
        }
    }, [mobile, mobileCollapsed])

    const disconnectFromServer = () => {
        if (provider.current) {
            //provider.current.disconnect()
            provider.current.destroy()
        }
        if (ydoc.current) {
            ydoc.current.destroy()
        }
        if (binding.current) {
            binding.current.destroy()
        }
    }

    const attachQuillRefs = () => {
        if (typeof reactQuillRef.getEditor !== 'function') return
        quillRef.current = reactQuillRef.getEditor()

        if (isInitialRefs.current && isLoadingData === 0) {
            quillRef.current.focus()
            isInitialRefs.current = false
        }
    }

    const storeInitialUserMentions = ops => {
        for (let i = 0; i < ops.length; i++) {
            const { mention } = ops[i].insert
            if (mention && mention.userId !== NOT_USER_MENTIONED) {
                initialUserMentionsIdsRef.current[mention.id] = true
            }
        }
    }

    const generateMentionTasks = ops => {
        const newUserMentionsIdsInThisSesion = []
        for (let i = 0; i < ops.length; i++) {
            const { mention } = ops[i].insert
            if (
                mention &&
                mention.userId !== NOT_USER_MENTIONED &&
                !initialUserMentionsIdsRef.current[mention.id] &&
                TasksHelper.getUserInProject(projectId, mention.userId)
            ) {
                newUserMentionsIdsInThisSesion.push(mention.userId)
            }
        }

        if (newUserMentionsIdsInThisSesion.length > 0) {
            Backend.createGenericTasksForMentionsInNoteContent(
                projectId,
                note.id,
                newUserMentionsIdsInThisSesion,
                note.assistantId
            )
            Backend.processFollowersWhenEditTexts(
                projectId,
                objectType,
                objectId,
                object,
                newUserMentionsIdsInThisSesion,
                false
            )
        }
    }

    const renderTask = () => {
        if (blockShortcuts) {
            return
        }
        storeModal(MANAGE_TASK_MODAL_ID)
    }

    const renderTimestamp = () => {
        if (blockShortcuts) {
            return
        }
        const editor = reactQuillRef.getEditor()
        const range = editor.getSelection(true)
        editor.insertText(range.index, moment().format(`${getDateFormat(false)} `), 'user')
        editor.insertText(range.index + 11, '\n', { header: 1 }, 'user')
        setTimeout(() => {
            editor.setSelection(range.index + 11, 0, 'user')
        })
    }

    const [clicked, setClicked] = useState(false)

    const renderShortcuts = () => {
        useEffect(() => {
            document.addEventListener('keydown', onKeyDown)
            return () => document.removeEventListener('keydown', onKeyDown)
        }, [])
        const preventDefault = event => {
            event.preventDefault()
            event.stopPropagation()
        }
        const onKeyDown = e => {
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeColorPopup()
                closeHeadingPopup()
            }
        }

        const execShortcutsFromPopups = (sht, event) => {
            const selectHeader = document.querySelector(`.ql-header.ql-picker.ql-expanded`)
            const selectTextColor = document.querySelector(`.ql-color.ql-picker.ql-color-picker.ql-expanded`)
            const selectBackColor = document.querySelector(`.ql-background.ql-picker.ql-color-picker.ql-expanded`)

            if (selectHeader) {
                switch (sht) {
                    case '1': {
                        preventDefault(event)
                        modules.toolbar.handlers.textFont(false, scrollRef, scrollYPos)
                        break
                    }
                    case '2': {
                        preventDefault(event)
                        modules.toolbar.handlers.textFont('3', scrollRef, scrollYPos)
                        break
                    }
                    case '3': {
                        preventDefault(event)
                        modules.toolbar.handlers.textFont('2', scrollRef, scrollYPos)
                        break
                    }
                    case '4': {
                        preventDefault(event)
                        modules.toolbar.handlers.textFont('1', scrollRef, scrollYPos)
                        break
                    }
                }
                closeHeadingPopup()
            }

            const applyColor = (color, type = 'color') => {
                preventDefault(event)
                modules.toolbar.handlers.textColor(color, scrollRef, scrollYPos, type)
            }

            if (selectTextColor) {
                switch (sht) {
                    case '0': {
                        applyColor(TEXT_COLORS[0].color)
                        break
                    }
                    case '1': {
                        applyColor(TEXT_COLORS[1].color)
                        break
                    }
                    case '2': {
                        applyColor(TEXT_COLORS[2].color)
                        break
                    }
                    case '3': {
                        applyColor(TEXT_COLORS[3].color)
                        break
                    }
                    case '4': {
                        applyColor(TEXT_COLORS[4].color)
                        break
                    }
                    case '5': {
                        applyColor(TEXT_COLORS[5].color)
                        break
                    }
                    case '6': {
                        applyColor(TEXT_COLORS[6].color)
                        break
                    }
                }
                closeColorPopup()
            }

            if (selectBackColor) {
                switch (sht) {
                    case '0': {
                        applyColor(BACKGROUND_COLORS[0].color, 'background')
                        break
                    }
                    case '1': {
                        applyColor(BACKGROUND_COLORS[1].color, 'background')
                        break
                    }
                    case '2': {
                        applyColor(BACKGROUND_COLORS[2].color, 'background')
                        break
                    }
                    case '3': {
                        applyColor(BACKGROUND_COLORS[3].color, 'background')
                        break
                    }
                    case '4': {
                        applyColor(BACKGROUND_COLORS[4].color, 'background')
                        break
                    }
                    case '5': {
                        applyColor(BACKGROUND_COLORS[5].color, 'background')
                        break
                    }
                    case '6': {
                        applyColor(BACKGROUND_COLORS[6].color, 'background')
                        break
                    }
                }
                closeColorPopup()
            }
        }
        return (
            <View>
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+T'}
                        onKeyDown={(sht, event) => {
                            preventDefault(event)
                            renderTask()
                        }}
                        filter={e => true}
                    />
                )}
                <Hotkeys
                    keyName={'alt+C'}
                    onKeyDown={(sht, event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        modules.toolbar.handlers.comment()
                    }}
                    filter={e => true}
                />
                <Hotkeys
                    keyName={'f11'}
                    onKeyDown={(sht, event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        switchScreenModes(!isFullscreen)
                    }}
                    filter={e => true}
                />
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+Z'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            modules.toolbar.handlers.strike()
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys keyName={'0,1,2,3,4,5,6'} onKeyDown={execShortcutsFromPopups} filter={e => true} />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'ctrl+space'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            modules.toolbar.handlers.clean()
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+U'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            modules.toolbar.handlers.image()
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+1'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openHeadingPopup()
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+2'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openColorPopup('ql-color')
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+3'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openColorPopup('ql-background')
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+4'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            renderTimestamp()
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'ctrl+k'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            modules.toolbar.handlers.link()
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+5'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            modules.toolbar.handlers.list('ordered')
                        }}
                        filter={e => true}
                    />
                )}
                {accessGranted && (
                    <Hotkeys
                        keyName={'alt+6'}
                        onKeyDown={(sht, event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            modules.toolbar.handlers.list('bullet')
                        }}
                        filter={e => true}
                    />
                )}
            </View>
        )
    }

    const scrollOnLayout = event => {
        const { height, width } = event.nativeEvent.layout
        dispatch(setNoteEditorScrollDimensions(width, height))
    }

    return (
        <View style={{ flexDirection: 'column', flex: 1 }} pointerEvents={isLoadingNoteData ? 'none' : 'auto'}>
            {renderShortcuts()}

            <EditorToolbar
                getEditor={() => quillRef.current}
                renderTask={renderTask}
                renderTimestamp={renderTimestamp}
                editors={editors}
                project={project}
                peersSynced={synced}
                clicked={clicked}
                setClicked={setClicked}
                accessGranted={accessGranted}
                isFullscreen={isFullscreen}
                setFullscreen={switchScreenModes}
                ptojectId={projectId}
                readOnly={readOnly}
                disabled={timeoutModalIsOpen.current || isLoadingNoteData}
                connectionState={connectionState}
                scrollYPos={scrollYPos}
                scrollRef={scrollRef}
                autoStartTranscription={autoStartTranscription}
            />

            <CustomScrollView
                ref={scrollRef}
                onScroll={e => {
                    const deltaY = e.nativeEvent.contentOffset.y
                    updateScreenMode(deltaY)
                }}
                style={{ backgroundColor: 'white' }}
                indicatorStyle={mobile && { right: -10 }}
                onScrollbarGone={() => {
                    scrollbarGone.current = true
                }}
                onScrollbarPresent={() => {
                    scrollbarGone.current = false
                }}
                nativeID={`${note.id}ParentScroll`}
                keyboardShouldPersistTaps="always"
                scrollOnLayout={scrollOnLayout}
            >
                <ReactQuill
                    ref={el => {
                        reactQuillRef = el
                        exportRef = el
                    }}
                    theme="snow"
                    value={state.value}
                    onChange={handleChange}
                    placeholder={createPlaceholder('Type your note...', QUILL_EDITOR_NOTE_TYPE, note.id)}
                    modules={modules}
                    formats={formats}
                    readOnly={timeoutModalIsOpen.current || isLoadingNoteData || !accessGranted || readOnly}
                    style={{ marginTop: clicked ? -34 : 0 }}
                    onChangeSelection={onChangeSelection}
                />
            </CustomScrollView>
        </View>
    )
}

export default NotesEditorView
