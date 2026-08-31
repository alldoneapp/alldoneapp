import React, { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import firebase from 'firebase/compat/app'
import moment from 'moment'
import v4 from 'uuid/v4'
import Hotkeys from 'react-hot-keys'
import ReactQuill from 'react-quill-new'
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
import styles, { colors, getRandomCollabColor } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
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
    captureSelectionFromEditor,
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
import { loadNoteContentWithRetry } from './noteContentLoader'
import { prepareSyncedNoteDocument, storageIsMissingLocalState } from './noteCollaborationRecovery'
import { createNoteLocalPersistence } from './noteLocalPersistence'
import { isBrowserOffline } from '../../../../utils/connectionState'
import { clearPendingNoteUpload, hasPendingNoteUpload } from '../../../../utils/Notes/pendingNoteUploads'
import { applyPastedDeltaToEditor } from './notePaste'

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
// Content this client only RECEIVED (a collaborator typing) is persisted far
// less eagerly than content the local user authored: the author's own client is
// already saving it, so our upload is a safety net, not the primary write path.
// See `isRemoteEditorChange` below (AT-2340).
const REMOTE_SAVE_INTERVAL = 60000
const NOTE_CONTENT_RETRY_DELAY = 5000

/**
 * Did this Quill change come from a collaborator rather than from this user?
 *
 * y-quill applies remote Yjs updates with `quill.updateContents(delta, this)` —
 * the QuillBinding instance itself is the change source — while every local
 * change carries a string source ('user' for typing, 'api' for the editor's own
 * programmatic edits such as the image-format rewrite, which ARE local and must
 * still be saved normally). Matching on the binding instance is therefore both
 * precise and conservative: anything we cannot positively attribute to the
 * binding is treated as local.
 */
export const isRemoteEditorChange = (source, bindingInstance) =>
    !!bindingInstance && typeof source === 'object' && source === bindingInstance

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
    onOpenSideChat,
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
    const [editorRevision, setEditorRevision] = useState(0)
    const [synced, setSynced] = useState(false)
    const [editors, setEditors] = useState([])
    const [dataLoaded, setDataLoaded] = useState(false)
    // The note's content could not be loaded AND the browser is offline — shown
    // as an explanatory message instead of an endless spinner (notes follow-ups).
    const [contentUnavailableOffline, setContentUnavailableOffline] = useState(false)
    // const [scrollEnabled, setScrollEnabled] = useState(false)
    const firstEditionRef = useRef(true)
    // "This note holds local state we could not compare against the canonical
    // Storage copy" — resolved on reconnect, never guessed (AT-2340).
    const catchUpUnverifiedRef = useRef(false)
    let loadingRef = useRef(true)
    let provider = useRef(null)
    let ydoc = useRef(null)
    let binding = useRef(null)
    let localPersistence = useRef(null)
    let dirtyEditor = useRef(false)
    // Content received from a collaborator and not yet persisted by us. Kept
    // apart from `dirtyEditor` so it can never stamp this user as the editor.
    const remoteDirtyEditor = useRef(false)
    let saveTimeoutHandle = useRef(null)
    const remoteSaveTimeoutHandle = useRef(null)
    const noteContentRetryTimeoutRef = useRef(null)
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
    // `cleanup` is returned from a mount-only effect, so it closes over the first
    // render's values. It used to hardcode `true` for userCanEditNote where
    // autosave passes `accessGranted` — meaning a user without write access
    // still wrote the note's preview and edition data on the way out (AT-2340).
    const accessGrantedRef = useRef(accessGranted)
    accessGrantedRef.current = accessGranted
    const needReplaceImageFormat = useRef(false)
    const readOnlyRef = useRef(readOnly)
    const timeoutRef = useRef(null)
    const timeoutModalIsOpen = useRef(false)
    const maxLengthWarningDisplayed = useRef(false)
    const innerTasksIdsRef = useRef([])
    const lastSeenEditionDateRef = useRef(null)

    const lastFullscreenChangeTime = useRef(0)
    const isFullscreenRef = useRef(isFullscreen)
    isFullscreenRef.current = isFullscreen

    const updateScreenMode = deltaY => {
        scrollYPos.current = deltaY
        const now = Date.now()
        const COOLDOWN_MS = 300

        const timeSinceLastChange = now - lastFullscreenChangeTime.current
        if (timeSinceLastChange < COOLDOWN_MS) {
            return
        }

        const shouldGoFullscreen = deltaY > getScrollTolerance(true) && !isFullscreenRef.current
        const shouldExitFullscreen = deltaY < getScrollTolerance(false) && isFullscreenRef.current

        if (shouldGoFullscreen) {
            lastFullscreenChangeTime.current = now
            setFullscreen(true)
        } else if (shouldExitFullscreen) {
            lastFullscreenChangeTime.current = now
            setFullscreen(false)
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

    const scanLinkedObjects = ({ forceWrite = false } = {}) => {
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
            {},
            // On teardown the backlink write must be issued at once: the
            // no-op comparison reads the local cache asynchronously, and a page
            // being unloaded may never run that continuation (AT-2340).
            { forceWrite }
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

    /**
     * Persist content this client only RECEIVED.
     *
     * Content only: no preview, no lastEditionDate/lastEditorId, no edited-today
     * entry, no started-editing feed, no follower. The collaborator who typed it
     * owns all of that on their own client; duplicating it here made two people
     * typing cost both of them the full save fan-out, and made each of them look
     * like the last editor of the other's text (AT-2340).
     */
    const persistRemoteContent = () => {
        clearTimeout(remoteSaveTimeoutHandle.current)
        remoteSaveTimeoutHandle.current = null
        if (!remoteDirtyEditor.current) return
        remoteDirtyEditor.current = false
        if (!ydoc.current || loadingRef.current) return

        const stateUpdate = Y.encodeStateAsUpdate(ydoc.current)
        setNoteData(projectId, note.id, stateUpdate, null, null, accessGrantedRef.current, { contentOnly: true })
    }

    const autosave = () => {
        clearTimeout(saveTimeoutHandle.current)
        saveTimeoutHandle.current = null
        if (dirtyEditor.current) {
            dirtyEditor.current = false
            // A local save uploads the merged document, which already contains
            // everything received from collaborators.
            remoteDirtyEditor.current = false
            clearTimeout(remoteSaveTimeoutHandle.current)
            remoteSaveTimeoutHandle.current = null

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

    const handleChange = (_value, delta, source) => {
        handleTextChangeForMentions()
        if (dataLoaded) {
            // A collaborator's edits must not dirty THIS editor: they are not our
            // edits, and marking them dirty ran the whole local save fan-out —
            // lastEditionDate/lastEditorId stamped with our id, the edited-today
            // list, the started-editing feed, the backlink write and
            // tryAddFollower — for text we merely received (AT-2340). The merged
            // document is still persisted, content-only and far more lazily, so
            // nothing is lost if the collaborator's own upload never lands.
            if (isRemoteEditorChange(source, binding.current)) {
                remoteDirtyEditor.current = true
                if (remoteSaveTimeoutHandle.current === null && !readOnlyRef.current) {
                    remoteSaveTimeoutHandle.current = setTimeout(persistRemoteContent, REMOTE_SAVE_INTERVAL)
                }
            } else {
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
        }
        checkForInnerTasksChanges(delta.ops, source)
        checkIfNeedReplaceFormats(delta.ops)
        setEditorRevision(revision => revision + 1)

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

    // Saves made offline reach only the local IndexedDB copy (the Firebase
    // Storage put fails); when connectivity returns while the editor is still
    // open, upload the current state so the canonical copy catches up
    // (OFFLINE_SUPPORT_PLAN.md Stage 6).
    //
    // This used to force `dirtyEditor` and autosave UNCONDITIONALLY on every
    // `online` event, so a Wi-Fi switch or a laptop wake re-uploaded the whole
    // note and re-stamped lastEditionDate/lastEditorId, the edited-today list,
    // the linked-parent write and the follower — for a note nobody had touched,
    // which in turn made every other open client re-download it. Now the
    // decision is measured against the canonical copy first, and a note the
    // server already has costs one read and no writes (AT-2340).
    useEffect(() => {
        const uploadOnReconnect = async () => {
            if (noteUnmountedRef.current || loadingRef.current || !ydoc.current || readOnly) return
            // Real unsaved edits already have an autosave scheduled; letting it
            // run avoids racing it with a second encode of the same document.
            if (dirtyEditor.current) return
            if (!catchUpUnverifiedRef.current && !hasPendingNoteUpload(note.id)) return

            try {
                const data = await loadNoteContentWithRetry(() => Backend.getNoteData(projectId, note.id), {
                    attemptTimeoutMs: 10000,
                })
                if (noteUnmountedRef.current || !ydoc.current) return
                const storageUpdate = data ? new Uint8Array(data) : new Uint8Array(0)
                catchUpUnverifiedRef.current = false
                if (!storageIsMissingLocalState(ydoc.current, storageUpdate)) {
                    clearPendingNoteUpload(note.id)
                    return
                }
                // Merge the canonical copy in first so the upload is the CRDT
                // union — an edit made elsewhere while we were offline must not
                // be clobbered by our catch-up.
                if (storageUpdate.length > 0) Y.applyUpdate(ydoc.current, storageUpdate, 'remote-storage-refresh')
                dirtyEditor.current = true
                autosave()
            } catch (error) {
                // Could not read the canonical copy: keep both flags so the next
                // reconnect (or the next open) retries the comparison.
                console.warn('Could not verify whether the note needs an offline catch-up upload', error)
            }
        }
        window.addEventListener('online', uploadOnReconnect)
        return () => window.removeEventListener('online', uploadOnReconnect)
    }, [readOnly])

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
                        externalId: id,
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
        Backend.removeNoteEditor(projectId, note.id, { id: loggedUser.uid, color: color.current })
        dispatch([resetLoadingData(), setIsLoadingNoteData(false)])
        clearTimeout(saveTimeoutHandle.current)
        saveTimeoutHandle.current = null
        clearTimeout(remoteSaveTimeoutHandle.current)
        remoteSaveTimeoutHandle.current = null
        clearTimeout(noteContentRetryTimeoutRef.current)
        noteContentRetryTimeoutRef.current = null

        if (!loadingRef.current && dirtyEditor.current) {
            const stateUpdate = Y.encodeStateAsUpdate(ydoc.current)
            // Same preview and same permission flag as `autosave` (AT-2340). This
            // used to write a raw `getText(0, 500)` — which is not what the note
            // list renders, so closing a note replaced its structured preview
            // with a plain-text one — and to hardcode `true` for the permission
            // flag, writing edition data for a user who may not have write access.
            const preview = getNotePreviewText(projectId, quillRef.current)
            scanLinkedObjects({ forceWrite: true })
            setNoteData(projectId, note.id, stateUpdate, preview, firstEditionRef, accessGrantedRef.current)
        } else if (!loadingRef.current && remoteDirtyEditor.current && !readOnlyRef.current) {
            // Received-only content: persist the merged document without claiming
            // authorship of it.
            const stateUpdate = Y.encodeStateAsUpdate(ydoc.current)
            setNoteData(projectId, note.id, stateUpdate, null, null, accessGrantedRef.current, { contentOnly: true })
        }
        dirtyEditor.current = false
        remoteDirtyEditor.current = false

        if (provider.current) {
            //provider.current.disconnect()
            provider.current.destroy()
        }
        // Closes the IndexedDB connection; the persisted note state itself stays,
        // that is the whole point (destroy() ≠ clearData()).
        if (localPersistence.current) {
            localPersistence.current.destroy()
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
    }, [editorRevision])

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

                // Check if plain text contains markdown - if so, prioritize markdown conversion
                if (textData && containsMarkdown(textData)) {
                    const parsedDelta = markdownToDelta(textData, Delta)

                    if (parsedDelta) {
                        applyPastedDeltaToEditor(exportRef.getEditor(), parsedDelta, Delta)

                        event.preventDefault()
                        return
                    }
                }

                // Fall back to HTML processing if available
                if (htmlData) {
                    const pastedDelta = exportRef.getEditor().clipboard.convert({ html: htmlData })
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

                    applyPastedDeltaToEditor(exportRef.getEditor(), finalDelta, Delta)

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

                    applyPastedDeltaToEditor(exportRef.getEditor(), parsedDelta, Delta)

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

        Backend.addNoteEditor(projectId, note.id, { id: loggedUser.uid, color: color.current })
        Backend.watchNotesCollab(projectId, note.id, editors => {
            if (editors) {
                setEditors(editors.editors)
            }
        })

        const loadNoteContent = async () => {
            try {
                // A failed Storage download is no longer fatal (OFFLINE_SUPPORT_PLAN.md
                // Stage 6): the local IndexedDB copy can still open the note.
                // prepareSyncedNoteDocument throws when there is truly nothing to
                // show, which lands in the retry path below exactly as before.
                // Offline the download is not even attempted — the Storage SDK
                // retries network failures internally for up to 2 minutes, which
                // held the spinner long before any offline fallback could run
                // (the Pixel "loads forever" report). The per-attempt timeout
                // bounds the degraded-but-"online" case the same way.
                let data = null
                if (isBrowserOffline()) {
                    console.warn('Browser is offline; skipping the note content download')
                } else {
                    try {
                        data = await loadNoteContentWithRetry(() => Backend.getNoteData(projectId, note.id), {
                            attemptTimeoutMs: 10000,
                        })
                    } catch (storageError) {
                        console.warn(
                            'Note content download failed; opening from local offline state if available',
                            storageError
                        )
                    }
                }
                if (noteUnmountedRef.current) return

                const collaboration = await prepareSyncedNoteDocument(
                    data,
                    document => {
                        return new WebsocketProvider(
                            getNotesCollaborationServerData().NOTES_COLLABORATION_SERVER,
                            note.id,
                            document
                        )
                    },
                    {
                        createLocalPersistence: document => createNoteLocalPersistence(note.id, document),
                        // A note whose content was never saved (no preview — the
                        // preview is written on every content autosave) is CORRECT
                        // when empty, so it may open offline with nothing anywhere:
                        // the case of a note just created offline. CRDT merge keeps
                        // this safe even against a false positive.
                        allowEmptyOpen: !(note.preview && note.preview.trim()),
                    }
                )
                if (noteUnmountedRef.current) {
                    collaboration.provider.destroy()
                    collaboration.localPersistence?.destroy()
                    collaboration.document.destroy()
                    return
                }

                ydoc.current = collaboration.document
                provider.current = collaboration.provider
                localPersistence.current = collaboration.localPersistence
                const type = ydoc.current.getText('quill')
                provider.current.on('synced', synced => {
                    setSynced(synced)
                })
                setSynced(provider.current.synced)
                provider.current.awareness.setLocalStateField('user', {
                    name: userName,
                    color: color.current,
                })
                binding.current = new QuillBinding(type, quillRef.current, provider.current.awareness)

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
                if (collaboration.recovered) {
                    console.warn('Recovered note content after a destructive collaboration sync', {
                        noteId: note.id,
                    })
                }
                // Only set when the canonical copy was actually READ and found to
                // be behind. When it could not be read (offline), the decision is
                // deferred via storageCatchUpUnverified rather than guessed —
                // guessing "yes" recorded every offline READ as an edit (AT-2340).
                catchUpUnverifiedRef.current = !!collaboration.storageCatchUpUnverified
                if (collaboration.storageNeedsLocalCatchUp && !readOnly) {
                    // A previous offline session edited this note and its writes never
                    // reached Firebase Storage. Upload the merged state now so the
                    // canonical copy catches up even if the user never edits again.
                    console.warn('Uploading offline note edits that had not reached Firebase Storage', {
                        noteId: note.id,
                    })
                    dirtyEditor.current = true
                    autosave()
                }
                setContentUnavailableOffline(false)
                loadingRef.current = false
                exportLoadingRef = false
                dispatch([resetLoadingData(), setIsLoadingNoteData(false)])
            } catch (error) {
                if (noteUnmountedRef.current) return
                binding.current?.destroy()
                provider.current?.destroy()
                localPersistence.current?.destroy()
                ydoc.current?.destroy()
                binding.current = null
                provider.current = null
                localPersistence.current = null
                ydoc.current = null
                // Offline with no local copy: tell the user why the note cannot
                // open instead of spinning forever; the retry below picks the
                // content up as soon as connectivity returns. The LoadingNoteData
                // spinner overlays the editor (zIndex 10000) and would cover the
                // message, so the loading flag is cleared while the explanation is
                // up — the editor stays locked through contentUnavailableOffline
                // in the pointerEvents/readOnly/disabled gates below.
                const unavailableOffline = isBrowserOffline()
                setContentUnavailableOffline(unavailableOffline)
                if (unavailableOffline) dispatch(setIsLoadingNoteData(false))
                console.error('Failed to load note content; keeping the editor locked and retrying', error)
                noteContentRetryTimeoutRef.current = setTimeout(loadNoteContent, NOTE_CONTENT_RETRY_DELAY)
            }
        }

        loadNoteContent()
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
        if (!dataLoaded) return
        if (lastSeenEditionDateRef.current === null) {
            lastSeenEditionDateRef.current = note?.lastEditionDate ?? 0
            return
        }

        const remoteEditionDate = note?.lastEditionDate ?? 0
        if (remoteEditionDate <= lastSeenEditionDateRef.current) return

        lastSeenEditionDateRef.current = remoteEditionDate

        // Local user's own edits already live in the Yjs doc via the WebSocket provider.
        // Only pull from storage for out-of-band writes (e.g. the assistant editing via a Cloud Function).
        if (note?.lastEditorId === loggedUser.uid) return

        Backend.getNoteData(projectId, note.id)
            .then(data => {
                if (noteUnmountedRef.current || !ydoc.current) return
                const update = new Uint8Array(data)
                if (update.length > 0) {
                    Y.applyUpdate(ydoc.current, update, 'remote-storage-refresh')
                }
            })
            .catch(error => {
                console.warn('Failed to refresh note from storage after remote edit', error)
            })
    }, [dataLoaded, note?.lastEditionDate, note?.lastEditorId])

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
        if (localPersistence.current) {
            localPersistence.current.destroy()
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

    // react-quill throws when the editor has not been instantiated yet, so every
    // caller that only needs a best-effort read goes through this.
    const getNoteEditor = () => {
        try {
            return reactQuillRef ? reactQuillRef.getEditor() : null
        } catch (error) {
            return null
        }
    }

    const renderTask = () => {
        if (blockShortcuts) {
            return
        }
        // Snapshot what is selected right now, before the modal mounts and takes
        // focus. The create-task popup pre-fills itself from this selection and
        // the created task tag replaces it in the note, so it has to be read at
        // press time rather than trusted to still be cached later.
        captureSelectionFromEditor(getNoteEditor())
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
        <View
            style={{ flexDirection: 'column', flex: 1 }}
            pointerEvents={isLoadingNoteData || contentUnavailableOffline ? 'none' : 'auto'}
        >
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
                projectId={projectId}
                readOnly={readOnly}
                disabled={timeoutModalIsOpen.current || isLoadingNoteData || contentUnavailableOffline}
                connectionState={connectionState}
                scrollYPos={scrollYPos}
                scrollRef={scrollRef}
                autoStartTranscription={autoStartTranscription}
                onOpenSideChat={onOpenSideChat}
            />

            {contentUnavailableOffline ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                    <Text style={[styles.title6, { color: colors.Text02, textAlign: 'center' }]}>
                        {translate('This note is not available offline yet')}
                    </Text>
                    <Text style={[styles.body1, { color: colors.Text03, textAlign: 'center', marginTop: 8 }]}>
                        {translate('It will load automatically when you are back online')}
                    </Text>
                </View>
            ) : null}
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
                    onChange={handleChange}
                    placeholder={createPlaceholder('Type your note...', QUILL_EDITOR_NOTE_TYPE, note.id)}
                    modules={modules}
                    formats={formats}
                    readOnly={
                        timeoutModalIsOpen.current ||
                        isLoadingNoteData ||
                        contentUnavailableOffline ||
                        !accessGranted ||
                        readOnly
                    }
                    style={{ marginTop: clicked ? -34 : 0 }}
                    onChangeSelection={onChangeSelection}
                />
            </CustomScrollView>
        </View>
    )
}

export default NotesEditorView
