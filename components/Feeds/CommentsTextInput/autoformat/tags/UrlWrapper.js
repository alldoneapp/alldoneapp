import React, { useEffect, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import TagsInteractionPopup from '../../../../NotesView/NotesDV/EditorView/TagsInteractionPopup'
import { exportRef } from '../../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { quillTextInputIsCalendarTask, quillTextInputRefs } from '../../CustomTextInput3'
import { addProtocol, checkDVLink, formatUrl, getUrlObject } from '../../../../../utils/LinkingHelper'
import { colors } from '../../../../styles/global'
import { getQuillEditorRef } from '../../textInputHelper'
import URLTrigger from '../../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../../utils/NavigationService'
import LinkTag, { getPathname } from '../../../../Tags/LinkTag'
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

    const performAction = currentUrl => {
        if (url.trim() !== currentUrl.trim()) {
            updateUrl(currentUrl)
        }
        if (type !== 'plain' && getModalParams(TAGS_EDIT_OBJECT_MODAL_ID) == null) {
            if (!loggedUser.isAnonymous || isShared) {
                closeModal()
                setTimeout(() => {
                    checkDVLink(type)
                    URLTrigger.processUrl(NavigationService, getPathname(currentUrl))
                }, 400)
            }
        } else {
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

                        if (type === 'task' && inNote) {
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
