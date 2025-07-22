import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Popover from 'react-tiny-popover'

import PrivacyButton from '../../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import HighlightButton from '../../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import TaskMoreButton from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Tasks/TaskMoreButton'
import DueDateButton from '../../UIControls/DueDateButton'
import CommentButton from '../../UIControls/CommentButton'
import FollowUpButton from '../../UIControls/FollowUpButton'
import { FEED_PUBLIC_FOR_ALL, FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../i18n/TranslationService'
import { useSelector, useDispatch } from 'react-redux'
import OpenDvButton from './OpenDvButton'
import GhostButton from '../../UIControls/GhostButton'
import Icon from '../../Icon'
import { updateFocusedTask } from '../../../utils/backends/Tasks/tasksFirestore'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn, popoverToTop } from '../../../utils/HelperFunctions'
import { colors } from '../../styles/global'

import TaskParentGoalModal from '../../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal'
import { TASK_PARENT_GOAL_MODAL_ID, storeModal, removeModal } from '../../ModalsManager/modalsManager'
import { showFloatPopup, hideFloatPopup } from '../../../redux/actions'
import { Keyboard } from 'react-native'
import Backend from '../../../utils/BackendBridge'
import { objectIsPublicForLoggedUser } from '../../TaskListView/Utils/TasksHelper'

export default function SecondaryButtonsArea({
    tmpTask,
    hasName,
    showButtonSpace,
    isSuggestedTask,
    adding,
    projectId,
    isObservedTask,
    isToReviewTask,
    accessGranted,
    loggedUserCanUpdateObject,
    isAssistant,
    onOpenDetailedView,
    setDueDateBeforeSave,
    setToBacklogBeforeSave,
    onDismissPopup,
    setPrivacyBeforeSave,
    setCommentBeforeSave,
    setEstimationBeforeSave,
    setFollowUpBeforeSave,
    setDescriptionBeforeSave,
    setParentGoalBeforeSave,
    dismissEditMode,
    setRecurrenceBeforeSave,
    setTempAutoEstimation,
    isPending,
    parentInTaskOutOfOpen,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)
    const inFocusTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }

    const loggedSetDueDateBeforeSave = (task, date, isObserved) => {
        setDueDateBeforeSave(date, isObserved)
    }

    const loggedSetToBacklogBeforeSave = (task, isObserved) => {
        setToBacklogBeforeSave(isObserved)
    }

    const focusTask = () => {
        updateFocusedTask(loggedUserId, projectId, inFocusTaskId === tmpTask.id ? null : tmpTask, null, null)
        dismissEditMode?.()
    }
    const focusButtonRef = React.useRef(null)
    const parentGoalButtonRef = useRef(null)

    const [showParentGoalModalUI, setShowParentGoalModalUI] = useState(false)
    const [activeGoalForModal, setActiveGoalForModal] = useState(null)
    const [isLoadingGoal, setIsLoadingGoal] = useState(false)
    const [goalForModalAtOpen, setGoalForModalAtOpen] = useState(null)

    const openParentGoalPopup = async e => {
        e?.preventDefault()
        e?.stopPropagation()
        Keyboard.dismiss()

        if (tmpTask.parentGoalId) {
            setIsLoadingGoal(true)
            try {
                const goal = await Backend.getGoalData(projectId, tmpTask.parentGoalId)
                if (goal && objectIsPublicForLoggedUser(goal, loggedUserId)) {
                    setGoalForModalAtOpen(goal)
                    setActiveGoalForModal(goal)
                } else {
                    setGoalForModalAtOpen(null)
                    setActiveGoalForModal(null)
                }
            } catch (error) {
                console.error('Error fetching parent goal:', error)
                setGoalForModalAtOpen(null)
                setActiveGoalForModal(null)
            }
            setIsLoadingGoal(false)
        } else {
            setGoalForModalAtOpen(null)
            setActiveGoalForModal(null)
        }

        dispatch(showFloatPopup())
        setShowParentGoalModalUI(true)
    }

    const hideParentGoalPopup = () => {
        dispatch(hideFloatPopup())
        setShowParentGoalModalUI(false)
        dismissEditMode?.()
    }

    const handleSetParentGoal = goal => {
        setParentGoalBeforeSave(goal)
        hideParentGoalPopup()
    }

    return (
        <View style={localStyles.container}>
            <OpenDvButton
                showButtonSpace={showButtonSpace}
                onOpenDetailedView={onOpenDetailedView}
                buttonItemStyle={buttonItemStyle}
                projectId={projectId}
                disabled={(adding && !hasName) || isLoadingGoal}
            />

            {loggedUserCanUpdateObject &&
                !tmpTask.done &&
                taskViewToggleSection !== 'Workflow' &&
                !tmpTask.gmailData && (
                    <DueDateButton
                        task={tmpTask}
                        projectId={projectId}
                        style={buttonItemStyle}
                        disabled={!hasName || !accessGranted || isLoadingGoal}
                        inEditTask={true}
                        saveDueDateBeforeSaveTask={loggedSetDueDateBeforeSave}
                        setToBacklogBeforeSaveTask={loggedSetToBacklogBeforeSave}
                        onDismissPopup={onDismissPopup}
                        shortcutText={'R'}
                        isObservedTask={isObservedTask}
                    />
                )}

            {adding ? (
                <PrivacyButton
                    projectId={projectId}
                    object={tmpTask}
                    objectType={FEED_TASK_OBJECT_TYPE}
                    disabled={!hasName || !accessGranted || isLoadingGoal}
                    savePrivacyBeforeSaveObject={setPrivacyBeforeSave}
                    inEditComponent={true}
                    style={buttonItemStyle}
                    shortcutText={'P'}
                />
            ) : (
                <CommentButton
                    style={buttonItemStyle}
                    task={tmpTask}
                    disabled={!hasName || isLoadingGoal}
                    inEditTask
                    saveCommentBeforeSaveTask={setCommentBeforeSave}
                    projectId={projectId}
                    onDismissPopup={onDismissPopup}
                    shortcutText={'C'}
                />
            )}

            {loggedUserCanUpdateObject && (
                <Hotkeys
                    keyName={'alt+f'}
                    disabled={!hasName || !accessGranted || blockShortcuts || isLoadingGoal}
                    onKeyDown={(sht, event) => execShortcutFn(focusButtonRef.current, focusTask, event)}
                    filter={e => true}
                >
                    <GhostButton
                        ref={focusButtonRef}
                        type={'ghost'}
                        icon={'crosshair'}
                        title={
                            !smallScreen
                                ? translate(inFocusTaskId === tmpTask.id ? 'Set out of focus' : 'Set in focus')
                                : null
                        }
                        noBorder={smallScreen}
                        buttonStyle={
                            inFocusTaskId === tmpTask.id
                                ? { ...buttonItemStyle, backgroundColor: colors.Primary050 }
                                : buttonItemStyle
                        }
                        iconColor={inFocusTaskId === tmpTask.id ? colors.Primary100 : colors.Text03}
                        onPress={focusTask}
                        disabled={!hasName || !accessGranted || isLoadingGoal}
                        shortcutText={'F'}
                    />
                </Hotkeys>
            )}

            {loggedUserCanUpdateObject && !isAssistant && !tmpTask.isSubtask && hasName && accessGranted && (
                <Popover
                    content={
                        <TaskParentGoalModal
                            activeGoal={goalForModalAtOpen || activeGoalForModal}
                            setActiveGoal={handleSetParentGoal}
                            projectId={projectId}
                            closeModal={hideParentGoalPopup}
                            notDelayClose={true}
                            ownerId={tmpTask.userId}
                        />
                    }
                    onClickOutside={hideParentGoalPopup}
                    isOpen={showParentGoalModalUI}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    disableReposition={true}
                    contentLocation={popoverToTop}
                >
                    <Hotkeys
                        keyName={'alt+g'}
                        disabled={!hasName || !accessGranted || blockShortcuts || isLoadingGoal}
                        onKeyDown={(sht, event) =>
                            execShortcutFn(parentGoalButtonRef.current, openParentGoalPopup, event)
                        }
                        filter={e => true}
                    >
                        <GhostButton
                            ref={parentGoalButtonRef}
                            type={'ghost'}
                            icon={isLoadingGoal ? 'loader' : 'target'}
                            title={!smallScreen ? translate('Parent goal') : null}
                            noBorder={smallScreen}
                            buttonStyle={buttonItemStyle}
                            iconColor={colors.Text03}
                            onPress={openParentGoalPopup}
                            disabled={!hasName || !accessGranted || isLoadingGoal}
                            shortcutText={'G'}
                        />
                    </Hotkeys>
                </Popover>
            )}

            {!adding && tmpTask.done && loggedUserCanUpdateObject && !isAssistant && (
                <FollowUpButton
                    buttonText={translate('Follow up')}
                    task={tmpTask}
                    projectId={projectId}
                    style={buttonItemStyle}
                    disabled={!hasName || !accessGranted || isLoadingGoal}
                    inEditTask={true}
                    saveDateBeforeSaveTask={setFollowUpBeforeSave}
                    onDismissPopup={onDismissPopup}
                    shortcutText={'J'}
                />
            )}

            {loggedUserCanUpdateObject && (
                <TaskMoreButton
                    editing={!adding}
                    formType={adding ? 'new' : 'edit'}
                    projectId={projectId}
                    task={
                        !tmpTask.parentGoalIsPublicFor ||
                        tmpTask.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                        tmpTask.parentGoalIsPublicFor.includes(loggedUserId)
                            ? tmpTask
                            : { ...tmpTask, parentGoalId: null, parentGoalIsPublicFor: null }
                    }
                    buttonStyle={buttonItemStyle}
                    saveDescription={setDescriptionBeforeSave}
                    dismissEditMode={dismissEditMode}
                    savePrivacyBeforeSaveObject={setPrivacyBeforeSave}
                    saveRecurrenceBeforeSaveTask={setRecurrenceBeforeSave}
                    disabled={!hasName || !accessGranted || isLoadingGoal}
                    isSuggestedTask={isSuggestedTask}
                    setEstimationBeforeSave={setEstimationBeforeSave}
                    isAssistant={isAssistant}
                    setTempAutoEstimation={setTempAutoEstimation}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
})
