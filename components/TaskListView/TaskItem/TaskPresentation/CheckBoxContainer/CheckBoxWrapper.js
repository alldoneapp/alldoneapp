import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import store from '../../../../../redux/store'
import Backend from '../../../../../utils/BackendBridge'
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
        isSuggested,
        isActiveOrganizeMode,
        checkOnDrag,
        loggedUserCanUpdateObject,
        highlightColor,
        accessGranted,
        pending,
        showWorkflowIndicator,
        isNextStepAi,
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
    const [showAnimation, setShowAnimation] = useState(false)
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

    const safeSetShowAnimation = value => {
        if (!isUnmountedRef.current) {
            setShowAnimation(value)
        }
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
        safeSetShowAnimation(false)
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

    const scheduleSetTaskStatus = recurrenceBaseDateOverride => {
        if (taskTransitionPendingRef.current) return
        taskTransitionPendingRef.current = true
        setTaskTransitionPending(true)
        setShowAnimation(true)
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
        }, ANIMATION_DURATION)
        timeoutsRef.current.push(t)
    }

    const scheduleMoveTasksFromOpen = (stepToMoveId, recurrenceBaseDateOverride) => {
        if (taskTransitionPendingRef.current) return
        taskTransitionPendingRef.current = true
        setTaskTransitionPending(true)
        setShowAnimation(true)
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
        }, ANIMATION_DURATION)
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
            moveTasksFromDone(projectId, task, OPEN_STEP).catch(rollbackOptimisticCheck)
        } else if (genericData || (isPrivate && !isLongPress) || calendarData || isLockedGmailTask) {
            shouldAskForRecurrenceDateBasis(DONE_STEP)
                ? setRecurrenceDateBasisModalIsOpen(true)
                : scheduleMoveTasksFromOpen(DONE_STEP)
        } else if (userIds.length === 1 && !isLongPress) {
            const workflow = getUserWorkflow(projectId, ownerIsWorkstream ? loggedUser.uid : userId)
            const workflowStepsIds = workflow ? Object.keys(workflow).sort(chronoKeysOrder) : []
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
        console.log('onCheckboxPress called - isLongPress:', isLongPress)
        if (taskTransitionPendingRef.current || emailCompletionSubmittingRef.current) return
        if (!checkIsLimitedByXp(projectId)) {
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

    // console.log('CheckBoxWrapper state - showAnimation:', showAnimation)

    return (
        <>
            {recurrenceDateBasisModalIsOpen ? (
                <Popover
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
                        showEmailCompletionIndicator={!!emailArchiveData}
                        isNextStepAi={isNextStepAi}
                        aiStepRunning={isNextStepAi && taskTransitionPending}
                        onCheckboxPress={onCheckboxPress}
                        checkBoxIdRef={checkBoxIdRef}
                        checked={checked}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject && !taskTransitionPending}
                    />
                </Popover>
            ) : emailCompletionModalIsOpen ? (
                <Popover
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
                        showEmailCompletionIndicator={!!emailArchiveData}
                        isNextStepAi={isNextStepAi}
                        aiStepRunning={isNextStepAi && taskTransitionPending}
                        onCheckboxPress={onCheckboxPress}
                        checkBoxIdRef={checkBoxIdRef}
                        checked={checked}
                        loggedUserCanUpdateObject={
                            loggedUserCanUpdateObject && !emailCompletionSubmitting && !taskTransitionPending
                        }
                    />
                </Popover>
            ) : isOpen ? (
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
                        showEmailCompletionIndicator={!!emailArchiveData}
                        isNextStepAi={isNextStepAi}
                        aiStepRunning={isNextStepAi && taskTransitionPending}
                        onCheckboxPress={onCheckboxPress}
                        checkBoxIdRef={checkBoxIdRef}
                        checked={checked}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject && !taskTransitionPending}
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
                    showEmailCompletionIndicator={!!emailArchiveData}
                    isNextStepAi={isNextStepAi}
                    aiStepRunning={isNextStepAi && taskTransitionPending}
                    onCheckboxPress={onCheckboxPress}
                    checkBoxIdRef={checkBoxIdRef}
                    checked={checked}
                    loggedUserCanUpdateObject={loggedUserCanUpdateObject && !taskTransitionPending}
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
