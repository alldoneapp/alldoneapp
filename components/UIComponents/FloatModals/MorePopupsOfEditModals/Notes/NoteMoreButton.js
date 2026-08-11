import React, { useRef, useState } from 'react'
import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import { FEED_NOTE_OBJECT_TYPE, FEED_OBJECT_NOTE_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import DeleteModalItem from './DeleteModalItem'
import { FORM_TYPE_EDIT } from '../../../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import {
    PROJECT_MODAL_ID,
    removeModal,
    RICH_CREATE_TASK_MODAL_ID,
    storeModal,
} from '../../../../ModalsManager/modalsManager'
import { useDispatch, useSelector } from 'react-redux'
import { Keyboard } from 'react-native'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import RichCreateTaskModal from '../../RichCreateTaskModal/RichCreateTaskModal'
import SelectProjectModal from '../../SelectProjectModal/SelectProjectModal'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import FollowingModalItem from './FollowingModalItem'
import GenericModalItem from '../Common/GenericModalItem'
import CopyLinkModalItem from '../Common/CopyLinkModalItem'

export default function NoteMoreButton({
    formType,
    projectId,
    note,
    wrapperStyle,
    buttonStyle,
    dismissEditMode,
    disabled,
    inMentionModal,
    shortcut = 'M',
}) {
    const dispatch = useDispatch()
    const [showAddTask, setShowAddTask] = useState(false)
    const [showProject, setShowProject] = useState(false)
    const modalRef = useRef()

    const link = !note.parentObject
        ? `${window.location.origin}/projects/${projectId}/notes/${note.id}/editor`
        : `${window.location.origin}/projects/${projectId}/${note.parentObject.type}/${note.parentObject.id}/note`
    const project = ProjectHelper.getProjectById(projectId)
    const isGuide = !!project.parentTemplateId

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const openPopup = (e, constant, setVisibilityModal) => {
        e?.preventDefault()
        e?.stopPropagation()
        Keyboard.dismiss()
        if (constant) storeModal(constant)
        dispatch(showFloatPopup())
        setVisibilityModal(true)
    }

    const hidePopups = (setVisibilityModal, modalId) => {
        if (modalId) removeModal(modalId)
        dispatch(hideFloatPopup())
        setVisibilityModal(false)
    }

    const delayHidePopups = (setVisibilityModal, modalId) => {
        setTimeout(() => {
            hidePopups(setVisibilityModal, modalId)
        })
    }

    const hideTaskPopup = () => {
        dismissModal()
        dismissEditMode?.()
    }

    const hideProjectPopup = newProject => {
        delayHidePopups(setShowProject, PROJECT_MODAL_ID)
        if (newProject?.hasOwnProperty('id')) {
            dismissModal()
        }
    }

    const onCloseMainModal = () => {
        if (showAddTask) {
            setShowAddTask(false)
            removeModal(RICH_CREATE_TASK_MODAL_ID)
        }
        if (showProject) {
            setShowProject(false)
            removeModal(PROJECT_MODAL_ID)
        }
    }

    const renderItems = () => {
        const list = []

        list.push(shortcut => {
            return (
                <GenericModalItem
                    key={'mbtn-addtask'}
                    icon={'check-square'}
                    text={'Add task'}
                    visibilityData={{ openPopup, constant: RICH_CREATE_TASK_MODAL_ID, visibilityFn: setShowAddTask }}
                    shortcut={shortcut}
                />
            )
        })

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <CopyLinkModalItem key={'mbtn-copy-link'} link={link} shortcut={shortcut} onPress={hideTaskPopup} />
                )
            })
        }

        if (formType === FORM_TYPE_EDIT && !note.parentObject && !isGuide) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-project'}
                        icon={'circle'}
                        text={'Project'}
                        visibilityData={{ openPopup, constant: PROJECT_MODAL_ID, visibilityFn: setShowProject }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <FollowingModalItem
                        key={'mbtn-following'}
                        projectId={projectId}
                        note={note}
                        closeModal={hideTaskPopup}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (formType === FORM_TYPE_EDIT) {
            list.push(shortcut => {
                return (
                    <DeleteModalItem
                        key={'mbtn-delete'}
                        projectId={projectId}
                        note={note}
                        onPress={dismissModal}
                        shortcut={shortcut}
                    />
                )
            })
        }

        return list
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            projectId={projectId}
            formType={formType}
            object={note}
            objectType={FEED_NOTE_OBJECT_TYPE}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut={shortcut}
            wrapperStyle={wrapperStyle}
            inMentionModal={inMentionModal}
            onCloseModal={onCloseMainModal}
            customModal={
                showAddTask ? (
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        sourceType={!note.parentObject ? FEED_NOTE_OBJECT_TYPE : FEED_OBJECT_NOTE_OBJECT_TYPE}
                        objectNoteType={note?.parentObject.type}
                        sourceId={!note.parentObject ? note.id : note?.parentObject.id}
                        closeModal={() => delayHidePopups(setShowAddTask, RICH_CREATE_TASK_MODAL_ID)}
                        triggerWhenCreateTask={hideTaskPopup}
                    />
                ) : showProject ? (
                    <SelectProjectModal
                        item={{ type: 'note', data: note }}
                        project={project}
                        closePopover={hideProjectPopup}
                    />
                ) : null
            }
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
