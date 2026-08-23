import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import store from '../../../../../redux/store'
import Backend from '../../../../../utils/BackendBridge'
import { setAssignee } from '../../../../../redux/actions'
import TasksHelper, { DONE_STEP, OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../Utils/TasksHelper'
import { getWorkflowStepsIdsSorted, popoverToSafePosition } from '../../../../../utils/HelperFunctions'
import { RECORD_SCREEN_MODAL_ID, RECORD_VIDEO_MODAL_ID } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import { MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import { WORKSTREAM_ID_PREFIX } from '../../../../Workstreams/WorkstreamHelper'
import { getUserWorkflow } from '../../../../ContactsView/Utils/ContactsHelper'
import { checkIsLimitedByXp } from '../../../../Premium/PremiumHelper'
import TaskFlowModal from './TaskFlowModal'
import CheckBoxContainer from './CheckBoxContainer'
import { COMPLETION_HOLD_MS, RETAINED_HOLD_MS } from '../taskCompletionMotion'
import { moveTasksFromDone, moveTasksFromOpen, setTaskStatus } from '../../../../../utils/backends/Tasks/tasksFirestore'
import { taskBypassesWorkflow } from '../../../../../utils/taskExecutionMode'
import { getEmailTaskArchiveData, isInboxSummaryGmailTask } from '../../../../../utils/Gmail/gmailTaskUtils'
import { performEmailLineAction } from '../../../../../utils/backends/EmailLine/emailLineBackend'
import RecurringTaskDateBasisModal, {
    shouldShowRecurringTaskDateBasisModal,
} from '../../../../UIComponents/FloatModals/RecurringTaskDateBasisModal/RecurringTaskDateBasisModal'
import EmailTaskCompletionModal from './EmailTaskCompletionModal'
import { completeEmailLinkedTask } from './emailTaskCompletion'
import { translate } from '../../../../../i18n/TranslationService'

function CheckBoxWrapper(
    {
        task,
        projectId,
        isObservedTask,
        isToReviewTask,
        isActiveOrganizeMode,
        checkOnDrag,
        loggedUserCanUpdateObject,
        highlightColor,
        accessGranted,
        pending,
        showWorkflowIndicator,
        isNextStepAi,
        beginCompletionMotion,
        cancelCompletionMotion,
        completionCelebration,
    },
    ref
) {
    // console.log('CheckBoxWrapper render - task:', task.id)
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [checked, setChecked] = useState(task.done)
    const [isOpen, setIsOpen] = useState(false)
    const [emailCompletionModalIsOpen, setEmailCompletionModalIsOpen] = useState(false)
    const [emailCompletionSubmitting, setEmailCompletionSubmitting] = useState(false)
    const [pendingEmailArchiveChoice, setPendingEmailArchiveChoice] = useState(null)
    const [recurrenceDateBasisModalIsOpen, setRecurrenceDateBasisModalIsOpen] = useState(false)
    const [taskTransitionPending, setTaskTransitionPending] = useState(false)
    const checkBoxIdRef = useRef(v4())
    const isUnmountedRef = useRef(false)
    const timeoutsRef = useRef([])
    const emailCompletionSubmittingRef = useRef(false)
    const taskTransitionPendingRef = useRef(false)
    const currentWorkflowStepId = task.stepHistory?.[task.stepHistory.length - 1]

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            // Clear any pending timeouts to avoid post-unmount updates
            timeoutsRef.current.forEach(t => clearTimeout(t))
            timeoutsRef.current = []
        }
    }, [])

    useEffect(() => {
        safeSetChecked(task.done)
    }, [task.done, currentWorkflowStepId])

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

    /**
     * AT-2404 — hands the row its completion animation and is told how long to hold the write.
     *
     * The duration is decided by `useTaskCompletionMotion`, not here, so the reduced-motion branch
     * (a static strike-through and a much shorter hold) needs no knowledge of it at this level.
     * Falls back to the standard hold if the row did not supply a handler, which keeps this
     * component usable — and its existing suite meaningful — outside `TaskPresentation`.
     *
     * @param {boolean} strikeThrough False when the checkbox advances a workflow task to its next
     *   step: the row still leaves the list, but the task is not done, so it must not be crossed
     *   out or tinted with the success colour.
     */
    const startCompletionMotion = strikeThrough => {
        // A subtask row never collapses, so it never needs the buffer that keeps a collapsing row
        // ahead of its own snapshot. Matters only when there is no row handler at all — inside
        // `TaskPresentation` the hook returns the authoritative duration.
        const fallbackHold = task.isSubtask || task.parentId ? RETAINED_HOLD_MS : COMPLETION_HOLD_MS
        if (typeof beginCompletionMotion !== 'function') return fallbackHold
        const holdMs = beginCompletionMotion({ strikeThrough })
        return typeof holdMs === 'number' ? holdMs : fallbackHold
    }

    const rollbackOptimisticCheck = async error => {
        console.error('[task transition] Could not persist checkbox action', error)
        if (getEmailTaskArchiveData(task)) {
            alert(`${translate("Task couldn't be completed")}: ${error.message}`)
        }
        let persistedTask = null
        try {
            persistedTask = await Backend.getTaskData(projectId, task.id)
        } catch (readError) {
            console.error('[task transition] Could not reload task after checkbox failure', readError)
        }
        safeSetChecked(persistedTask ? persistedTask.done : done)
        // The row already struck itself through and collapsed optimistically; the write failed, so
        // put it back rather than leaving an invisible zero-height row behind.
        if (typeof cancelCompletionMotion === 'function') cancelCompletionMotion()
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
        assigneeType,
    } = task

    const ownerIsWorkstream = userId?.startsWith(WORKSTREAM_ID_PREFIX)
    const isLockedGmailTask = isInboxSummaryGmailTask(task)
    const emailArchiveData = !done && !isSubtask ? getEmailTaskArchiveData(task) : null
    const hasUnresolvedSuggestion = !!task.suggestedBy

    const scheduleSetTaskStatus = recurrenceBaseDateOverride => {
        if (taskTransitionPendingRef.current) return
        taskTransitionPendingRef.current = true
        setTaskTransitionPending(true)
        // Only ever reached for a subtask being completed (the un-complete path writes directly),
        // so this is always a genuine "done".
        const holdMs = startCompletionMotion(true)
        const t = setTimeout(async () => {
            try {
                await setTaskStatus(
                    projectId,
                    taskId,
                    !done,
                    ownerIsWorkstream ? store.getState().loggedUser.uid : userId,
                    task,
                    '',
                    true,
                    estimations[OPEN_STEP],
                    estimations[OPEN_STEP],
                    recurrenceBaseDateOverride
                )
            } catch (error) {
                await rollbackOptimisticCheck(error)
            } finally {
                taskTransitionPendingRef.current = false
                if (!isUnmountedRef.current) setTaskTransitionPending(false)
            }
        }, holdMs)
        timeoutsRef.current.push(t)
    }

    const scheduleMoveTasksFromOpen = (stepToMoveId, recurrenceBaseDateOverride) => {
        if (taskTransitionPendingRef.current) return
        taskTransitionPendingRef.current = true
        setTaskTransitionPending(true)
        // `stepToMoveId` is DONE_STEP for a real completion, but a WORKFLOW STEP ID when ticking a
        // workflow task simply hands it to the next reviewer. Both leave this list and both get the
        // exit animation; only the first is crossed out, because only the first is done.
        const holdMs = startCompletionMotion(stepToMoveId === DONE_STEP)
        const t = setTimeout(async () => {
            try {
                await moveTasksFromOpen(
                    projectId,
                    task,
                    stepToMoveId,
                    null,
                    null,
                    estimations,
                    checkBoxIdRef.current,
                    recurrenceBaseDateOverride
                )
            } catch (error) {
                await rollbackOptimisticCheck(error)
            } finally {
                taskTransitionPendingRef.current = false
                if (!isUnmountedRef.current) setTaskTransitionPending(false)
            }
        }, holdMs)
        timeoutsRef.current.push(t)
    }

    const closeRecurrenceDateBasisModal = () => {
        setRecurrenceDateBasisModalIsOpen(false)
        setPendingEmailArchiveChoice(null)
        safeSetChecked(false)
    }

    const completeWithSelectedRecurrenceDateBasis = recurrenceBaseDateOverride => {
        setRecurrenceDateBasisModalIsOpen(false)
        if (pendingEmailArchiveChoice !== null) {
            const archiveEmail = pendingEmailArchiveChoice
            setPendingEmailArchiveChoice(null)
            setEmailCompletionModalIsOpen(true)
            persistEmailTaskCompletion(archiveEmail, recurrenceBaseDateOverride)
        } else {
            scheduleMoveTasksFromOpen(DONE_STEP, recurrenceBaseDateOverride)
        }
    }

    const shouldAskForRecurrenceDateBasis = stepToMoveId => {
        return stepToMoveId === DONE_STEP && shouldShowRecurringTaskDateBasisModal(task)
    }

    const closeEmailCompletionModal = () => {
        if (emailCompletionSubmittingRef.current) return
        setEmailCompletionModalIsOpen(false)
        safeSetChecked(false)
    }

    const persistEmailTaskCompletion = async (archiveEmail, recurrenceBaseDateOverride) => {
        if (emailCompletionSubmittingRef.current) return
        emailCompletionSubmittingRef.current = true
        setEmailCompletionSubmitting(true)

        try {
            await completeEmailLinkedTask({
                archiveEmail,
                archiveData: emailArchiveData,
                archiveEmailAction: performEmailLineAction,
                completeTask: () => {
                    setEmailCompletionModalIsOpen(false)
                    safeSetChecked(true)
                    scheduleMoveTasksFromOpen(DONE_STEP, recurrenceBaseDateOverride)
                },
            })
        } catch (error) {
            console.error('[email task completion] Could not archive linked email in background', error)
            alert(`${translate("Email couldn't be archived")}: ${error.message}`)
        } finally {
            emailCompletionSubmittingRef.current = false
            if (!isUnmountedRef.current) setEmailCompletionSubmitting(false)
        }
    }

    const completeEmailTask = archiveEmail => {
        if (emailCompletionSubmittingRef.current) return
        if (shouldAskForRecurrenceDateBasis(DONE_STEP)) {
            setEmailCompletionModalIsOpen(false)
            setPendingEmailArchiveChoice(archiveEmail)
            setRecurrenceDateBasisModalIsOpen(true)
        } else {
            persistEmailTaskCompletion(archiveEmail)
        }
    }

    const toggleCheckAction = isLongPress => {
        const { loggedUser } = store.getState()
        if (isSubtask) {
            if (!done) {
                scheduleSetTaskStatus()
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
                ).catch(rollbackOptimisticCheck)
            }
        } else if (done) {
            if (task.workflowTask) {
                const workflow = getUserWorkflow(projectId, userId, task)
                const firstWorkflowStepId = getWorkflowStepsIdsSorted(workflow)[0]
                if (firstWorkflowStepId) {
                    moveTasksFromDone(projectId, task, firstWorkflowStepId).catch(rollbackOptimisticCheck)
                } else {
                    safeSetChecked(true)
                }
            } else {
                moveTasksFromDone(projectId, task, OPEN_STEP).catch(rollbackOptimisticCheck)
            }
        } else if (
            taskBypassesWorkflow(task) ||
            genericData ||
            (isPrivate && !isLongPress) ||
            calendarData ||
            isLockedGmailTask
        ) {
            shouldAskForRecurrenceDateBasis(DONE_STEP)
                ? setRecurrenceDateBasisModalIsOpen(true)
                : scheduleMoveTasksFromOpen(DONE_STEP)
        } else if (!task.workflowTask && userIds.length === 1 && !isLongPress) {
            const workflow = getUserWorkflow(projectId, ownerIsWorkstream ? loggedUser.uid : userId, task)
            const workflowStepsIds = getWorkflowStepsIdsSorted(workflow)
            const stepToMoveId = workflowStepsIds[0] ? workflowStepsIds[0] : DONE_STEP
            shouldAskForRecurrenceDateBasis(stepToMoveId)
                ? setRecurrenceDateBasisModalIsOpen(true)
                : scheduleMoveTasksFromOpen(stepToMoveId)
        } else {
            const taskOwner = TasksHelper.getTaskOwner(userId, projectId)
            dispatch(setAssignee(ownerIsWorkstream ? loggedUser : taskOwner))
            openModal()
        }
    }

    const onCheckboxPress = isLongPress => {
        if (__DEV__) console.log('onCheckboxPress called - isLongPress:', isLongPress)
        if (taskTransitionPendingRef.current || emailCompletionSubmittingRef.current) return
        if (!checkIsLimitedByXp(projectId)) {
            if (hasUnresolvedSuggestion) {
                setChecked(true)
                openModal()
                return
            }
            if (emailArchiveData && !done) {
                setEmailCompletionModalIsOpen(true)
                return
            }
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

    const setFlowModalVisibility = visible => {
        safeSetIsOpen(visible)
        if (!visible) safeSetChecked(done)
    }

    useImperativeHandle(ref, () => ({
        onCheckboxPress,
    }))

    /**
     * Built once and spread into all four render branches below. They differ only in which popover
     * (if any) wraps the checkbox and — for the email branch — in one extra disabling condition, so
     * repeating twenty identical props four times was how `completionCelebration` could have landed
     * on three of them and silently done nothing on the fourth.
     */
    const checkBoxProps = {
        isSubtask,
        isObservedTask,
        isToReviewTask,
        isSuggested: hasUnresolvedSuggestion,
        isActiveOrganizeMode,
        checkOnDrag,
        highlightColor,
        accessGranted,
        pending,
        showWorkflowIndicator,
        showEmailCompletionIndicator: !!emailArchiveData,
        isNextStepAi,
        aiStepRunning: isNextStepAi && taskTransitionPending,
        onCheckboxPress,
        checkBoxIdRef,
        checked,
        completionCelebration,
        loggedUserCanUpdateObject: loggedUserCanUpdateObject && !taskTransitionPending,
    }

    return (
        <>
            {recurrenceDateBasisModalIsOpen ? (
                <AppPopover
                    content={
                        <RecurringTaskDateBasisModal
                            task={task}
                            projectId={projectId}
                            closePopover={closeRecurrenceDateBasisModal}
                            selectDateBasis={completeWithSelectedRecurrenceDateBasis}
                        />
                    }
                    onClickOutside={closeRecurrenceDateBasisModal}
                    isOpen={recurrenceDateBasisModalIsOpen}
                    padding={4}
                    position={['top']}
                    align={'center'}
                    contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
                    disableReposition
                >
                    <CheckBoxContainer {...checkBoxProps} />
                </AppPopover>
            ) : emailCompletionModalIsOpen ? (
                <AppPopover
                    content={
                        <EmailTaskCompletionModal
                            closePopover={closeEmailCompletionModal}
                            onComplete={completeEmailTask}
                            submitting={emailCompletionSubmitting}
                        />
                    }
                    onClickOutside={closeEmailCompletionModal}
                    isOpen={emailCompletionModalIsOpen}
                    padding={4}
                    position={['top']}
                    align={'center'}
                    contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
                    disableReposition
                >
                    <CheckBoxContainer
                        {...checkBoxProps}
                        loggedUserCanUpdateObject={
                            loggedUserCanUpdateObject && !emailCompletionSubmitting && !taskTransitionPending
                        }
                    />
                </AppPopover>
            ) : isOpen ? (
                <AppPopover
                    content={
                        <TaskFlowModal
                            task={task}
                            projectId={projectId}
                            isObservedTask={isObservedTask}
                            isToReviewTask={isToReviewTask}
                            isSuggested={hasUnresolvedSuggestion}
                            pending={pending}
                            cancelPopover={closeModal}
                            checkBoxIdRef={checkBoxIdRef}
                            setVisiblePopover={setFlowModalVisibility}
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
                    <CheckBoxContainer {...checkBoxProps} />
                </AppPopover>
            ) : (
                <CheckBoxContainer {...checkBoxProps} />
            )}
        </>
    )
}

export default forwardRef(CheckBoxWrapper)
