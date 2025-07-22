import React, { useRef, useState } from 'react'
import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import { FEED_GOAL_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import DeleteModalItem from './DeleteModalItem'
import { FORM_TYPE_EDIT } from '../../../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import { useDispatch } from 'react-redux'
import {
    HIGHLIGHT_MODAL_ID,
    PROJECT_MODAL_ID,
    removeModal,
    RICH_CREATE_TASK_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
    GOAL_DATE_RANGE_MODAL_ID,
    PRIVACY_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import { hideFloatPopup, setForceCloseGoalEditionId } from '../../../../../redux/actions'
import RichCreateTaskModal from '../../RichCreateTaskModal/RichCreateTaskModal'
import SelectProjectModal from '../../SelectProjectModal/SelectProjectModal'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import HighlightColorModal from '../../HighlightColorModal/HighlightColorModal'
import FollowingModalItem from './FollowingModalItem'
import CopyLinkModalItem from '../Common/CopyLinkModalItem'
import DescriptionModal from '../../DescriptionModal/DescriptionModal'
import GoalMilestoneRangeModal from '../../GoalMilestoneRangeModal/GoalMilestoneRangeModal'
import GoalModalItem from './GoalModalItem'
import PrivacyModal from '../../PrivacyModal/PrivacyModal'
import { getDvMainTabLink } from '../../../../../utils/LinkingHelper'

export default function GoalMoreButton({
    projectId,
    goal,
    buttonStyle,
    closeParent,
    disabled,
    updateCurrentChanges,
    updateDescription,
    updatePrivacy,
    updateHighlight,
    updateFollowState,
    updateDateRange,
    inMentionModal,
    refKey,
    inDoneMilestone,
    adding,
    editingLink,
}) {
    const dispatch = useDispatch()
    const [showAddTask, setShowAddTask] = useState(false)
    const [showDescription, setShowDescription] = useState(false)
    const [showPrivacy, setShowPrivacy] = useState(false)
    const [showDateRange, setShowDateRange] = useState(false)
    const [showHighlight, setShowHighlight] = useState(false)
    const [showProject, setShowProject] = useState(false)
    const modalRef = useRef()

    const link = `${window.location.origin}${getDvMainTabLink(projectId, goal.id, 'goals')}`
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
        if (showPrivacy) {
            dispatch(hideFloatPopup())
            setShowPrivacy(false)
            removeModal(PRIVACY_MODAL_ID)
        }
        if (showDateRange) {
            dispatch(hideFloatPopup())
            setShowDateRange(false)
            removeModal(GOAL_DATE_RANGE_MODAL_ID)
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

        if (!adding)
            list.push(shortcut => {
                return (
                    <GoalModalItem
                        key={'mbtn-privacy'}
                        icon={'unlock'}
                        text={'Privacy'}
                        visibilityFn={setShowPrivacy}
                        modalConstant={PRIVACY_MODAL_ID}
                        shortcut={shortcut}
                    />
                )
            })

        if (!adding && !editingLink && !inDoneMilestone) {
            list.push(shortcut => {
                return (
                    <GoalModalItem
                        key={'mbtn-dateRange'}
                        icon={'calendar'}
                        text={'Milestone'}
                        visibilityFn={setShowDateRange}
                        modalConstant={GOAL_DATE_RANGE_MODAL_ID}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (!adding && editingLink) {
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
        }

        if (!adding && !inDoneMilestone) {
            list.push(shortcut => {
                return (
                    <CopyLinkModalItem
                        key={'mbtn-copy-link'}
                        link={link}
                        shortcut={shortcut}
                        onPress={saveWhenCopyLink}
                    />
                )
            })
        }

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

        if (!adding && !isGuide)
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

        if (!adding)
            list.push(shortcut => {
                return (
                    <FollowingModalItem
                        key={'mbtn-following'}
                        projectId={projectId}
                        goal={goal}
                        closeModal={dismissModal}
                        shortcut={shortcut}
                        onChangeFollowState={updateFollowState}
                    />
                )
            })

        if (!adding)
            list.push(shortcut => {
                return (
                    <DeleteModalItem
                        refKey={refKey}
                        key={'mbtn-delete'}
                        projectId={projectId}
                        goal={goal}
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
            object={goal}
            objectType={FEED_GOAL_OBJECT_TYPE}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut="M"
            inMentionModal={inMentionModal}
            onCloseModal={onCloseMainModal}
            customModal={
                showDescription ? (
                    <DescriptionModal
                        projectId={projectId}
                        object={goal}
                        closeModal={dismissModal}
                        objectType={FEED_GOAL_OBJECT_TYPE}
                        updateDescription={updateDescription}
                    />
                ) : showPrivacy ? (
                    <PrivacyModal
                        object={goal}
                        objectType={FEED_GOAL_OBJECT_TYPE}
                        projectId={projectId}
                        closePopover={dismissModal}
                        delayClosePopover={dismissModal}
                        savePrivacyBeforeSaveObject={updatePrivacy}
                    />
                ) : showDateRange ? (
                    <GoalMilestoneRangeModal
                        projectId={projectId}
                        closeModal={dismissModal}
                        updateMilestoneDateRange={(date, rangeEdgePropertyName) => {
                            dismissModal()
                            updateDateRange(date, rangeEdgePropertyName)
                        }}
                        startingMilestoneDate={goal.startingMilestoneDate}
                        completionMilestoneDate={goal.completionMilestoneDate}
                        ownerId={goal.ownerId}
                    />
                ) : showAddTask ? (
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        sourceType={FEED_GOAL_OBJECT_TYPE}
                        sourceId={goal.id}
                        closeModal={dismissModal}
                        triggerWhenCreateTask={updateCurrentChanges}
                        sourceIsPublicFor={goal.sourceIsPublicFor}
                        lockKey={goal.lockKey || ''}
                    />
                ) : showHighlight ? (
                    <HighlightColorModal
                        onPress={saveHighlight}
                        selectedColor={goal.hasStar}
                        closeModal={dismissModal}
                    />
                ) : showProject ? (
                    <SelectProjectModal
                        item={{ type: 'goal', data: goal }}
                        project={project}
                        closePopover={() => {
                            dismissModal()
                            dispatch(setForceCloseGoalEditionId(refKey))
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
