import React, { useEffect, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import ReactQuill from 'react-quill'

import TagsInteractionPopup from '../../../../NotesView/NotesDV/EditorView/TagsInteractionPopup'
import MentionTag from './MentionTag'
import { colors } from '../../../../styles/global'
import { setSearchText, showGlobalSearchPopup } from '../../../../../redux/actions'
import { exportRef } from '../../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { quillTextInputRefs } from '../../CustomTextInput3'
import { getQuillEditorRef, NOT_USER_MENTIONED } from '../../textInputHelper'
import { dismissPopupInBackground } from '../../../../../utils/HelperFunctions'
import NavigationService from '../../../../../utils/NavigationService'
import URLTrigger from '../../../../../URLSystem/URLTrigger'
import { MENTION_SPACE_CODE } from '../../../Utils/HelperFunctions'
import EditObjectsInLinks from '../../../../EditObjectsInLinks/EditObjectsInLinks'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    FOLLOW_UP_MODAL_ID,
    getModalParams,
    MANAGE_TASK_MODAL_ID,
    TAGS_EDIT_OBJECT_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
    WORKFLOW_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import Backend from '../../../../../utils/BackendBridge'
import ContactsHelper from '../../../../ContactsView/Utils/ContactsHelper'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../../TaskListView/Utils/TasksHelper'
import { getAssistant } from '../../../../AdminPanel/Assistants/assistantsHelper'
import { getDvMainTabLink } from '../../../../../utils/LinkingHelper'

const Delta = ReactQuill.Quill.import('delta')

export default function MentionWrapper({ data }) {
    const { text = '', id: tagId = '', editorId = '', userIdAllowedToEditTags = '', userId = '' } = data
    const loggedUser = useSelector(state => state.loggedUser)
    const projectId = useSelector(state => state.quillTextInputProjectIdsByEditorId[editorId])
    const activeNoteIsReadOnly = useSelector(state => state.activeNoteIsReadOnly)
    const activeNoteId = useSelector(state => state.activeNoteId)
    const { editorRef } = getQuillEditorRef(exportRef, quillTextInputRefs, editorId)
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const [contact, setContact] = useState(undefined)
    const [isMember, setIsMember] = useState(false)
    const [isPrivate, setIsPrivate] = useState(false)
    const inReadOnlyNote = activeNoteId && (activeNoteIsReadOnly || loggedUser.isAnonymous)

    useEffect(() => {
        if (projectId && data && !getAssistant(data.userId)) {
            const watchId = Backend.getId()
            let userPath = `users/${userId}`
            Backend.watchObjectLTag('people', userPath, watchId, data => {
                if (data != null) {
                    const projectIndex = ProjectHelper.getProjectIndexById(projectId)
                    const contact = Backend.mapUserData(userId, data)
                    setContact(contact)
                    setIsMember(true)
                    setIsPrivate(ContactsHelper.isPrivateUser(projectIndex, contact))
                } else {
                    Backend.unwatchObjectLTag('people', userPath, watchId)
                    userPath = `projectsContacts/${projectId}/contacts/${userId}`

                    Backend.watchObjectLTag('people', userPath, watchId, data => {
                        if (data != null) {
                            const contact = Backend.mapContactData(userId, data)
                            setContact(contact)
                            setIsMember(false)
                            setIsPrivate(ContactsHelper.isPrivateContact(contact))
                        } else {
                            setContact(null)
                            Backend.unwatchObjectLTag('people', userPath, watchId)
                        }
                    })
                }
            })

            return () => contact != null && Backend.unwatchObjectLTag('people', userPath, watchId)
        }
    }, [projectId])

    useEffect(() => {
        if (contact && contact.displayName !== text.replaceAll(MENTION_SPACE_CODE, ' ')) {
            const contactName = contact.displayName.replaceAll(' ', MENTION_SPACE_CODE)
            updateMention(contactName, contact.uid)
        }
    }, [contact?.displayName])

    const openModal = () => {
        if (
            !inReadOnlyNote &&
            (!userIdAllowedToEditTags ||
                userIdAllowedToEditTags === 'null' ||
                userIdAllowedToEditTags === 'undefined' ||
                userIdAllowedToEditTags === loggedUser.uid)
        ) {
            setIsOpen(true)
        } else {
            performAction()
        }
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const performAction = () => {
        closeModal()
        if (!userId || userId === NOT_USER_MENTIONED) {
            dispatch([setSearchText(`@${text}`), showGlobalSearchPopup(false)])
        } else {
            setTimeout(() => {
                const objectType = TasksHelper.getPeopleTypeUsingId(userId, projectId)
                URLTrigger.processUrl(NavigationService, getDvMainTabLink(projectId, userId, objectType))
            }, 400)
        }
    }

    const selectItemToMention = user => {
        const contactName = user.displayName.replaceAll(' ', MENTION_SPACE_CODE)
        updateMention(contactName, user.uid)
    }

    const updateNonUserMention = newMention => {
        updateMention(newMention, NOT_USER_MENTIONED)
    }

    const updateMention = (mentionText, userId) => {
        if (editorRef != null) {
            const editor = editorRef.getEditor()
            closeModal()
            setTimeout(function () {
                const ops = editor.getContents().ops
                let tagPosition = 0
                for (let i = 0; i < ops.length; i++) {
                    const insert = ops[i].insert

                    if (insert && insert.mention && insert.mention.id === tagId) {
                        const mention = { ...insert.mention }
                        mention.text = mentionText
                        mention.userId = userId

                        const delta = new Delta()
                        delta.retain(tagPosition)
                        delta.delete(1)
                        delta.insert({ mention })
                        editor.updateContents(delta, 'user')
                        editor.setSelection(tagPosition + 1, 0, 'user')
                        break
                    }

                    tagPosition += typeof insert === 'string' ? insert.length : 1
                }
            }, 400)
        }
    }

    const normalMentionWithSpaces = () => {
        const parsedText = text.replaceAll(MENTION_SPACE_CODE, ' ')
        return parsedText
    }

    const closeWhenClickOutsideModal = () => {
        if (userId !== NOT_USER_MENTIONED && contact != null) {
            if (
                !exitsOpenModals([
                    COMMENT_MODAL_ID,
                    MANAGE_TASK_MODAL_ID,
                    FOLLOW_UP_MODAL_ID,
                    WORKFLOW_MODAL_ID,
                    TASK_DESCRIPTION_MODAL_ID,
                    TAGS_EDIT_OBJECT_MODAL_ID,
                ])
            ) {
                // dismissAllPopups()
                closeModal()
                dismissPopupInBackground(TAGS_EDIT_OBJECT_MODAL_ID)
            }
        } else {
            closeModal()
        }
    }

    return (
        <Popover
            content={
                contact === undefined ? null : (!userId ||
                      userId === NOT_USER_MENTIONED ||
                      contact == null ||
                      getModalParams(MANAGE_TASK_MODAL_ID) != null ||
                      getModalParams(TAGS_EDIT_OBJECT_MODAL_ID) != null) &&
                  !isPrivate ? (
                    <TagsInteractionPopup
                        ico="at-sign"
                        inputTextColor={colors.UtilityGreen200}
                        initialValue={normalMentionWithSpaces()}
                        performAction={performAction}
                        closeModal={closeModal}
                        updateValue={updateNonUserMention}
                        inMentionsEditionTag={true}
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                    />
                ) : (
                    <EditObjectsInLinks
                        projectId={projectId}
                        objectType={'people'}
                        objectData={contact}
                        userIsMember={isMember}
                        closeModal={closeModal}
                        isPrivate={isPrivate}
                    />
                )
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeWhenClickOutsideModal}
            isOpen={isOpen}
        >
            <MentionTag
                disabled={!projectId || loggedUser.isAnonymous || (data && getAssistant(data.userId))}
                mentionData={data}
                onPress={openModal}
                projectId={projectId}
            />
        </Popover>
    )
}
