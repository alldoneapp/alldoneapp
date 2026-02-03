import React, { useEffect, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import TagsInteractionPopup from '../../../../NotesView/NotesDV/EditorView/TagsInteractionPopup'
import { exportRef } from '../../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { quillTextInputIsCalendarTask, quillTextInputRefs } from '../../CustomTextInput3'
import {
    addProtocol,
    checkDVLink,
    formatUrl,
    getUrlObject,
    isValidPreConfigTaskLink,
} from '../../../../../utils/LinkingHelper'
import { colors } from '../../../../styles/global'
import { getQuillEditorRef } from '../../textInputHelper'
import URLTrigger from '../../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../../utils/NavigationService'
import LinkTag, { getPathname } from '../../../../Tags/LinkTag'
import { getPreConfigTask, getAssistantData } from '../../../../../utils/backends/Assistants/assistantsFirestore'
import { getAssistant, GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../../AdminPanel/Assistants/assistantsHelper'
import { setPreConfigTaskModalData, setIframeModalData } from '../../../../../redux/actions'
import { generateTaskFromPreConfig } from '../../../../../utils/assistantHelper'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    FOLLOW_UP_MODAL_ID,
    getModalParams,
    MANAGE_TASK_MODAL_ID,
    removeModal,
    storeModal,
    TAGS_EDIT_OBJECT_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
    WORKFLOW_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import { REGEX_URL } from '../../../Utils/HelperFunctions'
import ReactQuill from 'react-quill'
import EditObjectsInLinks from '../../../../EditObjectsInLinks/EditObjectsInLinks'

const Delta = ReactQuill.Quill.import('delta')

export default function UrlWrapper({ value, isShared }) {
    const dispatch = useDispatch()
    const virtualQuillLoaded = useSelector(state => state.virtualQuillLoaded)
    const projectId = useSelector(state => state.quillEditorProjectId)
    const loggedUser = useSelector(state => state.loggedUser)
    const activeNoteIsReadOnly = useSelector(state => state.activeNoteIsReadOnly)
    const activeNoteId = useSelector(state => state.activeNoteId)
    let { url = '', type = '', id: tagId = '', editorId = '', userIdAllowedToEditTags = '' } = value
    const { editorRef, inNote } = getQuillEditorRef(exportRef, quillTextInputRefs, editorId)
    const [isOpen, setIsOpen] = useState(false)
    const [canceled, setCanceled] = useState(false)
    const [userIsMember, setUserIsMember] = useState(true)
    const [objectType, setObjectType] = useState(null)
    const [objectData, setObjectData] = useState(null)
    const [objectProjectId, setObjectProjectId] = useState(null)
    const [isPrivate, setIsPrivate] = useState(false)
    const [showEditObjectPopup, setShowEditObjectPopup] = useState(false)
    const inReadOnlyNote = activeNoteId !== '' && (activeNoteIsReadOnly || loggedUser.isAnonymous)

    useEffect(() => {
        if (value.open?.toString() === 'true' && !virtualQuillLoaded) {
            openModal()
        }
    }, [])

    useEffect(() => {
        if (!isOpen && canceled && !virtualQuillLoaded) {
            // This time out is needed because
            // the clean format should be done after the popup is gone from the DOM
            // Otherwise the popup will remain in the view as a Ghost element
            setTimeout(() => cleanTextFormat(), 1000)
        }
    }, [isOpen])

    useEffect(() => {
        setTimeout(() => {
            setShowEditObjectPopup(
                (objectType != null &&
                    objectData != null &&
                    getModalParams(MANAGE_TASK_MODAL_ID) == null &&
                    getModalParams(TAGS_EDIT_OBJECT_MODAL_ID) == null) ||
                    isPrivate ||
                    // To check if current edit modal opened is an Edit Task
                    getModalParams(MANAGE_TASK_MODAL_ID)?.fromUrlTag?.[objectData?.id] === 1
            )
        }, 400)
    }, [objectType, objectData, isPrivate])

    const needShortTags = () => {
        const manageTaskModalData = getModalParams(MANAGE_TASK_MODAL_ID)
        return manageTaskModalData && manageTaskModalData.editorId === editorId
    }

    const openModal = e => {
        console.log('[UrlWrapper] openModal called:', { type, url, projectId })

        // For pre-configured tasks, directly execute the action (open the modal)
        if (type === 'preConfigTask' || isValidPreConfigTaskLink(url, projectId)) {
            console.log('[UrlWrapper] Detected preConfigTask, calling performAction')
            performAction(url)
            return
        }

        const isSkillAndLoggedUserIsNotOwner =
            objectType === 'skill' && (loggedUser.isAnonymous || objectData.userId !== loggedUser.uid)
        if (
            !isSkillAndLoggedUserIsNotOwner &&
            !inReadOnlyNote &&
            (!userIdAllowedToEditTags ||
                userIdAllowedToEditTags === 'null' ||
                userIdAllowedToEditTags === 'undefined' ||
                userIdAllowedToEditTags === loggedUser.uid)
        ) {
            const taskModalParam = getModalParams(MANAGE_TASK_MODAL_ID)?.fromUrlTag
            if (objectType != null && objectData != null && objectType === 'task' && taskModalParam == null) {
                // Register current Edit Task popup opened
                storeModal(MANAGE_TASK_MODAL_ID, { inTag: true, fromUrlTag: { [objectData?.id]: 1 } })
            }
            setIsOpen(true)
        } else {
            performAction(url)
        }
    }

    const closeModal = (cleanFormat = false) => {
        if (cleanFormat && type === 'plain') {
            setCanceled(true)
        }
        const taskModalParam = getModalParams(MANAGE_TASK_MODAL_ID)?.fromUrlTag
        if (
            objectType != null &&
            objectData != null &&
            objectType === 'task' &&
            taskModalParam?.[objectData.id] === 1
        ) {
            // Unregister the "unique" Edit Task popup opened
            removeModal(MANAGE_TASK_MODAL_ID)
        }
        setIsOpen(false)
        resetOpen()
    }

    const performAction = async currentUrl => {
        console.log('[UrlWrapper] performAction called:', { currentUrl, type, projectId })

        if (url.trim() !== currentUrl.trim()) {
            updateUrl(currentUrl)
        }

        // Handle pre-configured task links - open the task generator modal
        const isPreConfig = type === 'preConfigTask' || isValidPreConfigTaskLink(currentUrl, projectId)
        console.log('[UrlWrapper] isPreConfigTask check:', { type, isPreConfig })

        if (isPreConfig) {
            console.log('[UrlWrapper] Handling preConfigTask link')
            try {
                const urlObj = new URL(addProtocol(currentUrl))
                const assistantId = urlObj.searchParams.get('assistantId')
                const assistantProjectId = urlObj.searchParams.get('assistantProjectId') || projectId
                const pathParts = urlObj.pathname.split('/')
                const preConfigTasksIndex = pathParts.indexOf('preConfigTasks')
                const taskId = preConfigTasksIndex >= 0 ? pathParts[preConfigTasksIndex + 1] : null

                console.log('[UrlWrapper] Parsed URL:', { taskId, assistantId, assistantProjectId })

                if (taskId && assistantId) {
                    closeModal()
                    console.log('[UrlWrapper] Fetching preConfigTask...')
                    const task = await getPreConfigTask(assistantProjectId, assistantId, taskId)
                    console.log('[UrlWrapper] Got task:', task)

                    if (task) {
                        const taskType = task.type || 'prompt'
                        const targetProjectId = projectId || assistantProjectId

                        // Handle different task types
                        if (taskType === 'prompt' || taskType === 'webhook') {
                            // For prompt/webhook: show modal if has variables, otherwise execute directly
                            if (task.variables && task.variables.length > 0) {
                                // Get assistant from Redux, or fetch from backend
                                let assistant = getAssistant(assistantId)
                                console.log('[UrlWrapper] Got assistant from Redux:', assistant)

                                if (!assistant) {
                                    const fetchProjectId = isGlobalAssistant(assistantId)
                                        ? GLOBAL_PROJECT_ID
                                        : assistantProjectId
                                    console.log(
                                        '[UrlWrapper] Fetching assistant from backend, projectId:',
                                        fetchProjectId
                                    )
                                    assistant = await getAssistantData(fetchProjectId, assistantId)
                                    console.log('[UrlWrapper] Got assistant from backend:', assistant)
                                }

                                if (assistant) {
                                    console.log(
                                        '[UrlWrapper] Opening PreConfigTaskGeneratorModal for task with variables'
                                    )
                                    dispatch(setPreConfigTaskModalData(true, task, assistant, targetProjectId))
                                }
                            } else {
                                // No variables - execute directly
                                console.log('[UrlWrapper] Executing prompt task directly (no variables)')
                                const aiSettings =
                                    task.aiModel || task.aiTemperature || task.aiSystemMessage
                                        ? {
                                              model: task.aiModel,
                                              temperature: task.aiTemperature,
                                              systemMessage: task.aiSystemMessage,
                                          }
                                        : null
                                const taskMetadata = {
                                    ...(task.taskMetadata || {}),
                                    sendWhatsApp: !!task.sendWhatsApp,
                                }
                                generateTaskFromPreConfig(
                                    targetProjectId,
                                    task.name,
                                    assistantId,
                                    task.prompt,
                                    aiSettings,
                                    taskMetadata
                                )
                            }
                        } else if (taskType === 'iframe') {
                            // Open iframe modal
                            console.log('[UrlWrapper] Opening iframe modal:', task.link)
                            dispatch(setIframeModalData(true, task.link, task.name))
                        } else if (taskType === 'link') {
                            // Open external link in new tab
                            console.log('[UrlWrapper] Opening external link:', task.link)
                            window.open(task.link, '_blank')
                        } else {
                            // Unknown type - try to open as link
                            console.log('[UrlWrapper] Unknown task type, opening as link:', taskType)
                            if (task.link) {
                                window.open(task.link, '_blank')
                            }
                        }
                    }
                } else {
                    console.log('[UrlWrapper] Missing taskId or assistantId:', { taskId, assistantId })
                }
            } catch (error) {
                console.error('[UrlWrapper] Error opening pre-configured task:', error)
            }
            return
        }

        console.log('[UrlWrapper] Not a preConfigTask, checking other types')
        if (type !== 'plain' && type !== 'preConfigTask' && getModalParams(TAGS_EDIT_OBJECT_MODAL_ID) == null) {
            if (!loggedUser.isAnonymous || isShared) {
                closeModal()
                setTimeout(() => {
                    checkDVLink(type)
                    URLTrigger.processUrl(NavigationService, getPathname(currentUrl))
                }, 400)
            }
        } else if (type !== 'preConfigTask') {
            window.open(addProtocol(currentUrl), '_blank')
        }
    }

    const updateUrl = newUrl => {
        newUrl = addProtocol(newUrl)
        const editor = editorRef.getEditor()
        closeModal()
        setTimeout(function () {
            const ops = editor.getContents().ops
            let tagPosition = 0
            for (let i = 0; i < ops.length; i++) {
                const insert = ops[i].insert

                if (insert && insert.url && insert.url.id === tagId) {
                    const rootUrl = formatUrl(newUrl)
                    if (rootUrl) {
                        const newUrlObj = getUrlObject(
                            newUrl,
                            rootUrl,
                            objectProjectId,
                            editorId,
                            userIdAllowedToEditTags
                        )
                        const { type, objectId } = newUrlObj
                        const delta = new Delta()

                        delta.retain(tagPosition)
                        if (insert.url.url) {
                            delta.delete(1)
                        } else {
                            const delta2 = new Delta()
                            delta2.retain(tagPosition)
                            delta2.delete(1)
                            editor.updateContents(delta2)
                        }

                        const isObjectNoteUrl = newUrl && newUrl.endsWith('/note')
                        if (type === 'task' && inNote && !isObjectNoteUrl) {
                            const taskTagFormat = { id: tagId, taskId: objectId, editorId, objectUrl: url }
                            delta.insert({ taskTagFormat })
                        } else {
                            const url = { ...newUrlObj }
                            url.id = tagId
                            url.open = false
                            delta.insert({ url })
                        }

                        editor.updateContents(delta, 'user')
                        editor.setSelection(tagPosition + 1, 0, 'user')
                    }
                    break
                }

                tagPosition += typeof insert === 'string' ? insert.length : 1
            }
        }, 400)
    }

    const resetOpen = () => {
        setTimeout(function () {
            if (typeof editorRef?.getEditor !== 'function' || activeNoteId === '') return
            try {
                const editor = editorRef?.getEditor?.()
                const ops = editor.getContents().ops
                let tagPosition = 0
                for (let i = 0; i < ops.length; i++) {
                    const insert = ops[i].insert

                    if (insert && insert.url && insert.url.id === tagId && !insert.url.url) {
                        const url = { ...insert.url }
                        url.open = false

                        const delta = new Delta()
                        delta.retain(tagPosition)
                        delta.delete(1)
                        delta.insert({ url })
                        editor.updateContents(delta)
                        editor.setSelection(tagPosition + 1, 0)
                        break
                    }

                    tagPosition += typeof insert === 'string' ? insert.length : 1
                }
            } catch (error) {
                console.log('Editor Error')
            }
        }, 400)
    }

    const cleanTextFormat = () => {
        const editor = exportRef?.getEditor()

        if (editor) {
            const ops = editor.getContents().ops
            let length = 0
            for (let i = 0; i < ops.length; i++) {
                if (ops[i].insert) {
                    if (typeof ops[i].insert === 'object') {
                        if (ops[i].insert && ops[i].insert.url && ops[i].insert.url.id === tagId) {
                            const newDelta = new Delta()
                            newDelta.retain(length).delete(2)
                            editor.updateContents(newDelta)
                            break
                        }
                        length += 1
                    } else {
                        length += ops[i].insert.length
                    }
                }
            }
        }
    }

    const validateUrl = text => {
        return REGEX_URL.test(addProtocol(text))
    }

    const closeWhenClickOutsideModal = () => {
        const modalExceptions = [
            COMMENT_MODAL_ID,
            MANAGE_TASK_MODAL_ID,
            FOLLOW_UP_MODAL_ID,
            WORKFLOW_MODAL_ID,
            TASK_DESCRIPTION_MODAL_ID,
            TAGS_EDIT_OBJECT_MODAL_ID,
        ]

        if ((objectType == null && objectData == null) || !showEditObjectPopup || !exitsOpenModals(modalExceptions)) {
            // dismissAllPopups()
            if (!REGEX_URL.test(url) && exportRef) {
                closeModal(true)
            } else {
                closeModal()
            }
        }
    }

    return (
        <Popover
            content={
                showEditObjectPopup ? (
                    <EditObjectsInLinks
                        projectId={objectProjectId || projectId}
                        objectType={objectType}
                        objectData={objectData}
                        userIsMember={userIsMember}
                        closeModal={closeModal}
                        editorId={editorId}
                        editorRef={editorRef}
                        tagId={tagId}
                        isPrivate={isPrivate}
                        objectUrl={url}
                    />
                ) : (
                    <TagsInteractionPopup
                        ico="link"
                        inputTextColor={colors.Primary100}
                        initialValue={url}
                        performAction={performAction}
                        closeModal={closeModal}
                        updateValue={updateUrl}
                        textIsValid={validateUrl}
                    />
                )
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeWhenClickOutsideModal}
            isOpen={isOpen}
        >
            <LinkTag
                link={url}
                onPress={!quillTextInputIsCalendarTask[editorId] && openModal}
                shortTags={needShortTags()}
                expandInNote={true}
                setObjectType={setObjectType}
                setObjectData={setObjectData}
                setObjectProjectId={setObjectProjectId}
                setIsPrivate={setIsPrivate}
                setUserIsMember={setUserIsMember}
            />
        </Popover>
    )
}
