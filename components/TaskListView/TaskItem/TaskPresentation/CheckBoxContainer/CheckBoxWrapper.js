import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import store from '../../../../../redux/store'
import { setAssignee } from '../../../../../redux/actions'
import TasksHelper, { DONE_STEP, OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../Utils/TasksHelper'
import { chronoKeysOrder, popoverToSafePosition } from '../../../../../utils/HelperFunctions'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import { MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import { WORKSTREAM_ID_PREFIX } from '../../../../Workstreams/WorkstreamHelper'
import { getUserWorkflow } from '../../../../ContactsView/Utils/ContactsHelper'
import { checkIsLimitedByXp } from '../../../../Premium/PremiumHelper'
import TaskFlowModal from './TaskFlowModal'
import CheckBoxContainer from './CheckBoxContainer'
import TaskCompletionAnimation, { ANIMATION_DURATION } from '../../TaskCompletionAnimation'
import { moveTasksFromDone, moveTasksFromOpen, setTaskStatus } from '../../../../../utils/backends/Tasks/tasksFirestore'

function CheckBoxWrapper(
    {
        task,
        projectId,
        isObservedTask,
        isToReviewTask,
        isSuggested,
        isActiveOrganizeMode,
        checkOnDrag,
        loggedUserCanUpdateObject,
        highlightColor,
        accessGranted,
        pending,
        showWorkflowIndicator,
    },
    ref
) {
    // console.log('CheckBoxWrapper render - task:', task.id)
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [checked, setChecked] = useState(task.done)
    const [isOpen, setIsOpen] = useState(false)
    const [showAnimation, setShowAnimation] = useState(false)
    const checkBoxIdRef = useRef(v4())
    const isUnmountedRef = useRef(false)
    const timeoutsRef = useRef([])

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            // Clear any pending timeouts to avoid post-unmount updates
            timeoutsRef.current.forEach(t => clearTimeout(t))
            timeoutsRef.current = []
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) {
            setIsOpen(value)
        }
    }

    const safeSetChecked = value => {
        if (!isUnmountedRef.current) {
            setChecked(value)
        }
    }

    const safeSetShowAnimation = value => {
        if (!isUnmountedRef.current) {
            setShowAnimation(value)
        }
    }

    const {
        id: taskId,
        userId,
        userIds,
        isSubtask,
        done,
        estimations,
        genericData,
        isPrivate,
        calendarData,
        gmailData,
        assigneeType,
    } = task

    const ownerIsWorkstream = userId?.startsWith(WORKSTREAM_ID_PREFIX)

    const toggleCheckAction = isLongPress => {
        const { loggedUser } = store.getState()
        if (isSubtask) {
            if (!done) {
                setShowAnimation(true)
                // Delay task completion until animation finishes
                const t = setTimeout(() => {
                    setTaskStatus(
                        projectId,
                        taskId,
                        !done,
                        ownerIsWorkstream ? loggedUser.uid : userId,
                        task,
                        '',
                        true,
                        estimations[OPEN_STEP],
                        estimations[OPEN_STEP]
                    )
                }, ANIMATION_DURATION)
                timeoutsRef.current.push(t)
            } else {
                setTaskStatus(
                    projectId,
                    taskId,
                    !done,
                    ownerIsWorkstream ? loggedUser.uid : userId,
                    task,
                    '',
                    true,
                    estimations[OPEN_STEP],
                    estimations[OPEN_STEP]
                )
            }
        } else if (done) {
            moveTasksFromDone(projectId, task, OPEN_STEP)
        } else if (genericData || (isPrivate && !isLongPress) || calendarData || gmailData) {
            setShowAnimation(true)
            // Delay task completion until animation finishes
            const t = setTimeout(() => {
                moveTasksFromOpen(projectId, task, DONE_STEP, null, null, estimations, checkBoxIdRef.current)
            }, ANIMATION_DURATION)
            timeoutsRef.current.push(t)
        } else if (userIds.length === 1 && !isLongPress) {
            setShowAnimation(true)
            const workflow = getUserWorkflow(projectId, ownerIsWorkstream ? loggedUser.uid : userId)
            const workflowStepsIds = workflow ? Object.keys(workflow).sort(chronoKeysOrder) : []
            // Delay task completion until animation finishes
            const t = setTimeout(() => {
                moveTasksFromOpen(
                    projectId,
                    task,
                    workflowStepsIds[0] ? workflowStepsIds[0] : DONE_STEP,
                    null,
                    null,
                    estimations,
                    checkBoxIdRef.current
                )
            }, ANIMATION_DURATION)
            timeoutsRef.current.push(t)
        } else {
            const taskOwner = TasksHelper.getTaskOwner(userId, projectId)
            dispatch(setAssignee(ownerIsWorkstream ? loggedUser : taskOwner))
            openModal()
        }
    }

    const onCheckboxPress = isLongPress => {
        console.log('onCheckboxPress called - isLongPress:', isLongPress)
        if (!checkIsLimitedByXp(projectId)) {
            const isAssistant = assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
            setChecked(!checked)
            toggleCheckAction(isLongPress && !isAssistant)
        }
    }

    const openModal = () => {
        safeSetIsOpen(true)
    }

    const closeModal = () => {
        const { openModals, isQuillTagEditorOpen } = store.getState()
        if (
            !isQuillTagEditorOpen &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID] &&
            !openModals[MENTION_MODAL_ID]
        ) {
            safeSetIsOpen(false)
            safeSetChecked(false)
        }
    }

    useImperativeHandle(ref, () => ({
        onCheckboxPress,
    }))

    // console.log('CheckBoxWrapper state - showAnimation:', showAnimation)

    return (
        <>
            {isOpen ? (
                <Popover
                    content={
                        <TaskFlowModal
                            task={task}
                            projectId={projectId}
                            isObservedTask={isObservedTask}
                            isToReviewTask={isToReviewTask}
                            isSuggested={isSuggested}
                            pending={pending}
                            cancelPopover={closeModal}
                            checkBoxIdRef={checkBoxIdRef}
                            setVisiblePopover={safeSetIsOpen}
                        />
                    }
                    onClickOutside={closeModal}
                    isOpen={isOpen}
                    padding={4}
                    position={['top']}
                    align={'center'}
                    contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
                    disableReposition
                >
                    <CheckBoxContainer
                        isSubtask={isSubtask}
                        isObservedTask={isObservedTask}
                        isToReviewTask={isToReviewTask}
                        isSuggested={isSuggested}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        checkOnDrag={checkOnDrag}
                        highlightColor={highlightColor}
                        accessGranted={accessGranted}
                        pending={pending}
                        showWorkflowIndicator={showWorkflowIndicator}
                        onCheckboxPress={onCheckboxPress}
                        checkBoxIdRef={checkBoxIdRef}
                        checked={checked}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                    />
                </Popover>
            ) : (
                <CheckBoxContainer
                    isSubtask={isSubtask}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    isSuggested={isSuggested}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    checkOnDrag={checkOnDrag}
                    highlightColor={highlightColor}
                    accessGranted={accessGranted}
                    pending={pending}
                    showWorkflowIndicator={showWorkflowIndicator}
                    onCheckboxPress={onCheckboxPress}
                    checkBoxIdRef={checkBoxIdRef}
                    checked={checked}
                    loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                />
            )}
            <TaskCompletionAnimation
                visible={showAnimation}
                onAnimationComplete={() => {
                    console.log('Animation completed callback')
                    safeSetShowAnimation(false)
                }}
            />
        </>
    )
}

export default forwardRef(CheckBoxWrapper)
