import React, { useRef, useState, useEffect } from 'react'
import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import { FEED_TASK_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import DeleteModalItem from './DeleteModalItem'
import { useDispatch, useSelector } from 'react-redux'
import { Keyboard } from 'react-native'
import {
    ESTIMATIONS_MODAL_ID,
    HIGHLIGHT_MODAL_ID,
    PRIVACY_MODAL_ID,
    PROJECT_MODAL_ID,
    RECURRING_MODAL_ID,
    removeModal,
    storeModal,
    TASK_DESCRIPTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
    TASK_WORKFLOW_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import DescriptionModal from '../../DescriptionModal/DescriptionModal'
import PrivacyModal from '../../PrivacyModal/PrivacyModal'
import RecurrenceModal from '../../RecurrenceModal'
import SelectProjectModal from '../../SelectProjectModal/SelectProjectModal'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import useGetTaskWorkflow from '../../../../../utils/useGetTaskWorkflow'
import StatusPicker from '../../../../TaskDetailedView/Properties/StatusPicker'
import FollowingModalItem from './FollowingModalItem'
import GenericModalItem from '../Common/GenericModalItem'
import CopyLinkModalItem from '../Common/CopyLinkModalItem'
import TaskParentGoalModal from '../../TaskParentGoalModal/TaskParentGoalModal'
import Backend from '../../../../../utils/BackendBridge'
import v4 from 'uuid/v4'
import EstimationModal from '../../EstimationModal/EstimationModal'
import { getTaskAutoEstimation, objectIsPublicForLoggedUser } from '../../../../TaskListView/Utils/TasksHelper'
import { getEstimationIconByValue } from '../../../../../utils/EstimationHelper'
import { getDvMainTabLink } from '../../../../../utils/LinkingHelper'
import { setTaskAutoEstimation, setTaskHighlight } from '../../../../../utils/backends/Tasks/tasksFirestore'
import HighlightColorModal from '../../HighlightColorModal/HighlightColorModal'
import { translate } from '../../../../../i18n/TranslationService'

export default function TaskMoreButton({
    formType,
    projectId,
    task,
    wrapperStyle,
    buttonStyle,
    disabled,
    saveDescription,
    dismissEditMode,
    updateActiveGoal,
    savePrivacyBeforeSaveObject,
    saveRecurrenceBeforeSaveTask,
    shortcut = 'M',
    isSuggestedTask,
    setEstimationBeforeSave,
    isAssistant,
    editing,
    setTempAutoEstimation,
}) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [showDescription, setShowDescription] = useState(false)
    const [showParentGoal, setShowParentGoal] = useState(false)
    const [showPrivacy, setShowPrivacy] = useState(false)
    const [showRecurrence, setShowRecurrence] = useState(false)
    const [showProject, setShowProject] = useState(false)
    const [showWorkflow, setShowWorkflow] = useState(false)
    const [showEstimation, setShowEstimation] = useState(false)
    const [showHighlight, setShowHighlight] = useState(false)
    const [activeGoal, setActiveGoal] = useState(null)
    const modalRef = useRef()

    const hidePrivacyButton = !task.isSubtask && !task.done && task.userIds.length > 1

    const link = `${window.location.origin}${getDvMainTabLink(projectId, task.id, 'tasks')}`
    const project = ProjectHelper.getProjectById(projectId)
    const workflow = useGetTaskWorkflow(projectId, task)
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

    const hideDescriptionPopup = () => {
        hidePopups(setShowDescription, TASK_DESCRIPTION_MODAL_ID)
        dismissModal()
    }

    const hideParentGoalPopup = () => {
        hidePopups(setShowParentGoal, TASK_PARENT_GOAL_MODAL_ID)
        dismissModal()
    }

    const hidePrivacyPopup = () => {
        hidePopups(setShowPrivacy, PRIVACY_MODAL_ID)
        dismissModal()
    }

    const hideEstimationPopup = () => {
        hidePopups(setShowEstimation)
        dismissModal()
    }

    const hideHighlightPopup = () => {
        hidePopups(setShowHighlight, HIGHLIGHT_MODAL_ID)
        dismissModal()
    }

    const savePrivacy = (isPrivate, isPublicFor) => {
        savePrivacyBeforeSaveObject(isPrivate, isPublicFor)
    }

    const hideRecurrencePopup = () => {
        hidePopups(setShowRecurrence, RECURRING_MODAL_ID)
        dismissModal()
    }

    const hideProjectPopup = () => {
        hidePopups(setShowProject, PROJECT_MODAL_ID)
        dismissModal()
        dismissEditMode?.()
    }

    const hideWorkflowPopup = () => {
        hidePopups(setShowWorkflow, TASK_WORKFLOW_MODAL_ID)
        dismissModal()
        dismissEditMode?.()
    }

    const hideNoModalsProperties = () => {
        dismissModal()
        dismissEditMode?.()
        if (showHighlight) {
            setShowHighlight(false)
            removeModal(HIGHLIGHT_MODAL_ID)
            dispatch(hideFloatPopup())
        }
    }

    const onCloseMainModal = () => {
        if (showDescription) {
            setShowDescription(false)
            removeModal(TASK_DESCRIPTION_MODAL_ID)
            dispatch(hideFloatPopup())
        }
        if (showPrivacy) {
            setShowPrivacy(false)
            dispatch(hideFloatPopup())
        }
        if (showParentGoal) {
            setShowParentGoal(false)
            dispatch(hideFloatPopup())
        }
        if (showRecurrence) {
            setShowRecurrence(false)
            removeModal(RECURRING_MODAL_ID)
            dispatch(hideFloatPopup())
        }
        if (showProject) {
            setShowProject(false)
            removeModal(PROJECT_MODAL_ID)
            dispatch(hideFloatPopup())
        }
        if (showWorkflow) {
            setShowWorkflow(false)
            removeModal(TASK_WORKFLOW_MODAL_ID)
            dispatch(hideFloatPopup())
        }
        if (showHighlight) {
            setShowHighlight(false)
            removeModal(HIGHLIGHT_MODAL_ID)
            dispatch(hideFloatPopup())
        }
    }

    const renderItems = () => {
        const list = []

        if (editing) {
            list.push(shortcut => {
                return (
                    <CopyLinkModalItem
                        key={'mbtn-copy-link'}
                        link={link}
                        shortcut={shortcut}
                        onPress={hideNoModalsProperties}
                    />
                )
            })
        }

        if (!isAssistant) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-estimation'}
                        icon={`count-circle-${getEstimationIconByValue(
                            projectId,
                            task.estimations[task.stepHistory[task.stepHistory.length - 1]]
                        )}`}
                        text={'Estimation'}
                        visibilityData={{ openPopup, constant: ESTIMATIONS_MODAL_ID, visibilityFn: setShowEstimation }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (!task.calendarData && !task.gmailData && !isAssistant) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-description'}
                        icon={'info'}
                        text={'Description'}
                        visibilityData={{
                            openPopup,
                            constant: TASK_DESCRIPTION_MODAL_ID,
                            visibilityFn: setShowDescription,
                        }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (editing && !hidePrivacyButton && !isAssistant) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-privacy'}
                        icon={'unlock'}
                        text={'Privacy'}
                        visibilityData={{ openPopup, visibilityFn: setShowPrivacy }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (!task.calendarData && !task.gmailData && !isAssistant) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-recurring'}
                        icon={'rotate-cw'}
                        text={'Recurring'}
                        visibilityData={{ openPopup, constant: RECURRING_MODAL_ID, visibilityFn: setShowRecurrence }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (editing && !task.gmailData && !isGuide && !isAssistant) {
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

        if (editing && !task.calendarData && !task.gmailData) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-workflow'}
                        icon={'workflow'}
                        text={'Workflow'}
                        visibilityData={{ openPopup, constant: TASK_WORKFLOW_MODAL_ID, visibilityFn: setShowWorkflow }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (editing) {
            list.push(shortcut => {
                return (
                    <FollowingModalItem
                        key={'mbtn-following'}
                        projectId={projectId}
                        task={task}
                        closeModal={hideNoModalsProperties}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (editing) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'mbtn-highlight'}
                        icon={'highlight'}
                        text={translate('Highlight')}
                        visibilityData={{
                            openPopup,
                            constant: HIGHLIGHT_MODAL_ID,
                            visibilityFn: setShowHighlight,
                        }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        if (editing) {
            list.push(shortcut => {
                return (
                    <DeleteModalItem
                        key={'mbtn-delete'}
                        projectId={projectId}
                        task={task}
                        shortcut={shortcut}
                        onPress={dismissModal}
                    />
                )
            })
        }

        return list
    }

    const setActiveGoalData = goal => {
        const isPublic = objectIsPublicForLoggedUser(goal)
        setActiveGoal(isPublic ? goal : null)
    }

    const setAutoEstimation = autoEstimation => {
        if (editing) setTaskAutoEstimation(projectId, task, autoEstimation)
        setTempAutoEstimation(autoEstimation)
    }

    const selectHighlightColor = (e, data) => {
        const colorValue = data.color
        setTaskHighlight(projectId, task.id, colorValue, task)
        hideHighlightPopup()
        dismissEditMode?.()
    }

    useEffect(() => {
        const { parentGoalId } = task

        if (parentGoalId) {
            const watcherKey = v4()
            Backend.watchGoal(projectId, parentGoalId, watcherKey, setActiveGoalData)
            return () => {
                Backend.unwatch(projectId, watcherKey)
            }
        }
    }, [task.parentGoalId])

    const estimation = task.estimations[task.stepHistory[task.stepHistory.length - 1]]

    return (
        <MoreButtonWrapper
            ref={modalRef}
            projectId={projectId}
            formType={formType}
            object={task}
            objectType={FEED_TASK_OBJECT_TYPE}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut={shortcut}
            wrapperStyle={wrapperStyle}
            onCloseModal={onCloseMainModal}
            customModal={
                showDescription ? (
                    <DescriptionModal
                        projectId={projectId}
                        object={task}
                        closeModal={hideDescriptionPopup}
                        objectType={FEED_TASK_OBJECT_TYPE}
                        updateDescription={saveDescription}
                    />
                ) : showParentGoal ? (
                    <TaskParentGoalModal
                        activeGoal={activeGoal}
                        setActiveGoal={updateActiveGoal}
                        projectId={projectId}
                        closeModal={hideParentGoalPopup}
                        notDelayClose={true}
                        ownerId={task.userId}
                    />
                ) : showPrivacy ? (
                    <PrivacyModal
                        object={task}
                        objectType={FEED_TASK_OBJECT_TYPE}
                        projectId={projectId}
                        delayClosePopover={hidePrivacyPopup}
                        savePrivacyBeforeSaveObject={savePrivacy}
                    />
                ) : showRecurrence ? (
                    <RecurrenceModal
                        task={task}
                        projectId={projectId}
                        saveRecurrenceBeforeSaveTask={saveRecurrenceBeforeSaveTask}
                        closePopover={hideRecurrencePopup}
                    />
                ) : showProject ? (
                    <SelectProjectModal
                        item={{ type: 'task', data: task }}
                        project={project}
                        closePopover={hideProjectPopup}
                    />
                ) : showWorkflow ? (
                    <StatusPicker
                        projectId={projectId}
                        task={task}
                        workflow={workflow}
                        hidePopover={hideWorkflowPopup}
                    />
                ) : showEstimation ? (
                    <EstimationModal
                        projectId={projectId}
                        estimation={estimation}
                        setEstimationFn={setEstimationBeforeSave}
                        closePopover={hideEstimationPopup}
                        autoEstimation={getTaskAutoEstimation(projectId, estimation, task.autoEstimation)}
                        setAutoEstimation={setAutoEstimation}
                        showAutoEstimation={!task.isSubtask}
                        disabled={!!task.calendarData}
                    />
                ) : showHighlight ? (
                    <HighlightColorModal
                        onPress={selectHighlightColor}
                        selectedColor={task.hasStar}
                        onClickOutside={hideHighlightPopup}
                    />
                ) : null
            }
        >
            {renderItems().map((itemFn, index, arr) => {
                const hotkey = index === arr.length - 1 ? '0' : (index + 1).toString()
                return itemFn(hotkey)
            })}
        </MoreButtonWrapper>
    )
}
