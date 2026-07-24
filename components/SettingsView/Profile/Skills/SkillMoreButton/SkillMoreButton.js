import React, { useRef, useState } from 'react'
import { useDispatch } from 'react-redux'

import MoreButtonWrapper from '../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/MoreButtonWrapper'
import { FEED_SKILL_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import DeleteModalItem from './DeleteModalItem'
import { FORM_TYPE_EDIT } from '../../../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import {
    HIGHLIGHT_MODAL_ID,
    PROJECT_MODAL_ID,
    removeModal,
    RICH_CREATE_TASK_MODAL_ID,
    SKILL_COMPLETION_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import { hideFloatPopup, setForceCloseSkillEditionId } from '../../../../../redux/actions'
import RichCreateTaskModal from '../../../../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import SelectProjectModal from '../../../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModal'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import HighlightColorModal from '../../../../UIComponents/FloatModals/HighlightColorModal/HighlightColorModal'
import FollowingModalItem from './FollowingModalItem'
import CopyLinkModalItem from '../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/CopyLinkModalItem'
import DescriptionModal from '../../../../UIComponents/FloatModals/DescriptionModal/DescriptionModal'
import GoalModalItem from '../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Goals/GoalModalItem'
import SkillCompletionModal from '../SkillCompletionWrapper/SkillCompletionModal'
import { getDvMainTabLink } from '../../../../../utils/LinkingHelper'

export default function SkillMoreButton({
    projectId,
    skill,
    buttonStyle,
    closeParent,
    disabled,
    updateCurrentChanges,
    updateDescription,
    updateHighlight,
    refKey,
    inEditModal,
    updateFollowState,
    updateCompletion,
}) {
    const dispatch = useDispatch()
    const [showAddTask, setShowAddTask] = useState(false)
    const [showDescription, setShowDescription] = useState(false)
    const [showHighlight, setShowHighlight] = useState(false)
    const [showProject, setShowProject] = useState(false)
    const [showCompletion, setShowCompletion] = useState(false)
    const modalRef = useRef()

    const link = `${window.location.origin}${getDvMainTabLink(projectId, skill.id, 'skills')}`
    const project = ProjectHelper.getProjectById(projectId)
    const isGuide = !!project.parentTemplateId

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const saveWhenCopyLink = () => {
        dismissModal()
        closeParent()
    }

    const saveHighlight = (e, data) => {
        updateHighlight(data.color)
    }

    const onCloseMainModal = () => {
        if (showDescription) {
            dispatch(hideFloatPopup())
            setShowDescription(false)
            removeModal(TASK_DESCRIPTION_MODAL_ID)
        }
        if (showAddTask) {
            dispatch(hideFloatPopup())
            setShowAddTask(false)
            removeModal(RICH_CREATE_TASK_MODAL_ID)
        }
        if (showHighlight) {
            dispatch(hideFloatPopup())
            setShowHighlight(false)
            removeModal(HIGHLIGHT_MODAL_ID)
        }
        if (showProject) {
            dispatch(hideFloatPopup())
            setShowProject(false)
            removeModal(PROJECT_MODAL_ID)
        }
        if (showCompletion) {
            dispatch(hideFloatPopup())
            setShowCompletion(false)
            removeModal(SKILL_COMPLETION_MODAL_ID)
        }
    }

    const renderItems = () => {
        const list = []

        list.push(shortcut => {
            return (
                <GoalModalItem
                    key={'mbtn-description'}
                    icon={'info'}
                    text={'Description'}
                    visibilityFn={setShowDescription}
                    modalConstant={TASK_DESCRIPTION_MODAL_ID}
                    shortcut={shortcut}
                />
            )
        })

        list.push(shortcut => {
            return (
                <GoalModalItem
                    key={'mbtn-completion'}
                    icon={'bar-chart-2-Horizontal'}
                    text={'Completion'}
                    visibilityFn={setShowCompletion}
                    modalConstant={SKILL_COMPLETION_MODAL_ID}
                    shortcut={shortcut}
                />
            )
        })

        list.push(shortcut => {
            return (
                <GoalModalItem
                    key={'mbtn-addtask'}
                    icon={'check-square'}
                    text={'Add task'}
                    visibilityFn={setShowAddTask}
                    modalConstant={RICH_CREATE_TASK_MODAL_ID}
                    shortcut={shortcut}
                />
            )
        })

        list.push(shortcut => {
            return (
                <CopyLinkModalItem key={'mbtn-copy-link'} link={link} shortcut={shortcut} onPress={saveWhenCopyLink} />
            )
        })

        list.push(shortcut => {
            return (
                <GoalModalItem
                    key={'mbtn-highlight'}
                    icon={'highlight'}
                    text={'Highlight'}
                    visibilityFn={setShowHighlight}
                    modalConstant={HIGHLIGHT_MODAL_ID}
                    shortcut={shortcut}
                />
            )
        })

        if (!isGuide) {
            list.push(shortcut => {
                return (
                    <GoalModalItem
                        key={'mbtn-project'}
                        icon={'circle'}
                        text={'Project'}
                        visibilityFn={setShowProject}
                        modalConstant={PROJECT_MODAL_ID}
                        shortcut={shortcut}
                    />
                )
            })
        }

        list.push(shortcut => {
            return (
                <FollowingModalItem
                    key={'mbtn-following'}
                    projectId={projectId}
                    skill={skill}
                    closeModal={dismissModal}
                    shortcut={shortcut}
                    onChangeFollowState={updateFollowState}
                />
            )
        })

        list.push(shortcut => {
            return (
                <DeleteModalItem
                    refKey={refKey}
                    key={'mbtn-delete'}
                    projectId={projectId}
                    skill={skill}
                    onPress={dismissModal}
                    shortcut={shortcut}
                />
            )
        })

        return list
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            projectId={projectId}
            formType={FORM_TYPE_EDIT}
            object={skill}
            objectType={FEED_SKILL_OBJECT_TYPE}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut="M"
            inMentionModal={inEditModal}
            noBorder={inEditModal}
            onCloseModal={onCloseMainModal}
            customModal={
                showDescription ? (
                    <DescriptionModal
                        projectId={projectId}
                        object={skill}
                        closeModal={dismissModal}
                        objectType={FEED_SKILL_OBJECT_TYPE}
                        updateDescription={updateDescription}
                    />
                ) : showCompletion ? (
                    <SkillCompletionModal
                        closeModal={dismissModal}
                        changeCompletion={updateCompletion}
                        completion={skill.completion}
                        projectId={projectId}
                        skillId={skill.id}
                    />
                ) : showAddTask ? (
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        sourceType={FEED_SKILL_OBJECT_TYPE}
                        sourceId={skill.id}
                        closeModal={dismissModal}
                        triggerWhenCreateTask={updateCurrentChanges}
                    />
                ) : showHighlight ? (
                    <HighlightColorModal
                        onPress={saveHighlight}
                        selectedColor={skill.hasStar}
                        closeModal={dismissModal}
                    />
                ) : showProject ? (
                    <SelectProjectModal
                        item={{ type: 'skill', data: skill }}
                        project={project}
                        closePopover={() => {
                            dismissModal()
                            dispatch(setForceCloseSkillEditionId(refKey))
                        }}
                        onSelectProject={closeParent}
                    />
                ) : null
            }
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
