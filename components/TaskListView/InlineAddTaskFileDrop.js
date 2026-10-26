import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import store from '../../redux/store'
import { setTmpInputTextTask, unsetAddTaskRepeatMode } from '../../redux/actions'
import RichCreateTaskModal from '../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import CreateTaskFileDropZone from '../UIComponents/FloatModals/RichCreateTaskModal/CreateTaskFileDropZone'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import withSafePopover from '../UIComponents/HOC/withSafePopover'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { FEED_GOAL_OBJECT_TYPE, FEED_TASK_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import useModalSizing from '../../hooks/useModalSizing'
import useLiftAboveKeyboard from '../../hooks/useLiftAboveKeyboard'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'
import useTaskEditorLock from '../../hooks/useTaskEditorLock'
import { BACKLOG_DATE_NUMERIC } from './Utils/TasksHelper'
import SharedHelper from '../../utils/SharedHelper'

/**
 * AT-2875 — a file dropped on an inline "Add new task" line opens the add-task popup
 * (RichCreateTaskModal) with that file already attached, so the user keeps writing there.
 *
 * Nothing about attachments is implemented here. The popup owns them exactly as it does for a
 * drop on the popup itself: the files become local draft words in the description and are only
 * uploaded — once, against the finally selected project — when the task is submitted. A drop
 * therefore never creates a task on its own and never uploads anything up front.
 *
 * What the line contributes is its context, so the popup creates the task where the inline
 * editor would have: the project, the line's date (a future day or Someday; today stays the
 * popup's default), its goal, and the draft title. The title is the shared `tmpInputTextTask`
 * draft that the inline editor writes on every keystroke and restores whenever it opens, so it
 * covers both a drop on the open editor and on the collapsed line. The inline editor is closed
 * without creating anything; the draft is only cleared once the popup actually submits, so
 * cancelling the popup hands the text back to the inline line.
 */

// The due date the popup should start with, or undefined for the popup's own default (now).
export const getDroppedTaskDueDate = ({ inBacklog, defaultDate, now = Date.now() }) => {
    if (inBacklog) return BACKLOG_DATE_NUMERIC
    if (!Number.isFinite(defaultDate)) return undefined
    // Today's line was rendered at some earlier moment of today; let the popup stamp "now".
    return moment(defaultDate).isSame(moment(now), 'day') ? undefined : defaultDate
}

// The parent-goal source the popup understands (it sets parentGoalId/isPublicFor/lockKey).
export const getDroppedTaskGoalSource = goal =>
    goal && goal.id
        ? {
              sourceType: FEED_GOAL_OBJECT_TYPE,
              sourceId: goal.id,
              sourceIsPublicFor: goal.isPublicFor,
              lockKey: goal.lockKey,
          }
        : { sourceType: FEED_TASK_OBJECT_TYPE }

function InlineAddTaskFileDrop({
    children,
    projectId,
    enabled,
    inlineEditorRef,
    activeGoal,
    defaultDate,
    inBacklog,
    useLoggedUser,
    expandTasksList,
    tryExpandTasksListInGoalWhenAddTask,
    openPopover,
    closePopover,
    isOpen,
}) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const loggedUser = useSelector(state => state.loggedUser)
    const popupLock = useFloatPopupLock()
    const taskEditorLock = useTaskEditorLock()
    const popupCardRef = useRef(null)
    const keyboardLift = useLiftAboveKeyboard(popupCardRef)
    const { maxHeight: popupMaxHeight, isSheet } = useModalSizing({ size: 'L' })
    // Same gate as the line's own "+" checkbox (AddTask): no access, no new task.
    const canDrop = !!enabled && SharedHelper.accessGranted(loggedUser, projectId)
    const [draft, setDraft] = useState({ sequence: 0, files: [], taskName: '' })

    const onFilesDropped = files => {
        // A drop while the popup is already open is not ours: the popup has its own zone.
        if (!canDrop || isOpen || !files || files.length === 0) return

        // Same quota gate as every other attachment drop. Checked before opening so a limited
        // user sees the limit modal instead of an empty popup.
        const { checkIsLimitedByTraffic } = require('../Premium/PremiumHelper')
        if (checkIsLimitedByTraffic(projectId)) return

        const { tmpInputTextTask, addTaskRepeatMode } = store.getState()
        const taskName = typeof tmpInputTextTask === 'string' ? tmpInputTextTask.trim() : ''

        // Close the inline editor WITHOUT creating anything; its text lives on in the draft.
        if (inlineEditorRef?.current?.modalIsVisible?.()) inlineEditorRef.current.closeModal(false, true)
        if (addTaskRepeatMode) dispatch(unsetAddTaskRepeatMode())

        setDraft(previous => ({ sequence: previous.sequence + 1, files: Array.from(files), taskName }))
        openPopover()
        popupLock.acquire()
        taskEditorLock.acquire()
    }

    const handleClose = () => {
        if (isQuillTagEditorOpen || openModals[MENTION_MODAL_ID]) return
        closePopover()
        popupLock.release()
        taskEditorLock.release()
        // Release the File objects; the popup revokes its own blob URLs on unmount.
        setDraft(previous => ({ ...previous, files: [] }))
    }

    const onDraftSubmitted = () => {
        dispatch(setTmpInputTextTask(''))
    }

    const goalSource = getDroppedTaskGoalSource(activeGoal)

    return (
        <AppPopover
            isOpen={isOpen}
            align="start"
            containerStyle={{ zIndex: 9999, overflow: 'visible' }}
            padding={8}
            offsetY={5}
            onClickOutside={handleClose}
            content={
                <div
                    ref={popupCardRef}
                    style={{
                        position: 'relative',
                        backgroundColor: 'var(--background-primary)',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
                        ...(isSheet
                            ? {}
                            : {
                                  maxHeight: popupMaxHeight,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  overflow: 'hidden',
                                  transform: keyboardLift ? `translateY(-${keyboardLift}px)` : undefined,
                                  transition: 'transform 150ms ease-out',
                              }),
                    }}
                >
                    <RichCreateTaskModal
                        key={draft.sequence}
                        initialProjectId={projectId}
                        fromTaskList={true}
                        useLoggedUser={useLoggedUser}
                        closeModal={handleClose}
                        initialTaskName={draft.taskName}
                        initialFiles={draft.files}
                        initialDueDate={getDroppedTaskDueDate({ inBacklog, defaultDate })}
                        onDraftSubmitted={onDraftSubmitted}
                        sourceType={goalSource.sourceType}
                        sourceId={goalSource.sourceId}
                        sourceIsPublicFor={goalSource.sourceIsPublicFor}
                        lockKey={goalSource.lockKey}
                        expandTaskListIfNeeded={!!expandTasksList}
                        setPressedShowMoreMainSection={expandTasksList ? () => expandTasksList() : undefined}
                        tryExpandTasksListInGoalWhenAddTask={tryExpandTasksListInGoalWhenAddTask}
                    />
                </div>
            }
        >
            {/* The popover anchors to the first DOM node of its children, so it must be a real
                box: the drop zone's own wrapper is `display: contents` and measures as 0x0. */}
            <View>
                <CreateTaskFileDropZone
                    onFilesDropped={onFilesDropped}
                    disabled={!canDrop || isOpen}
                    label="Drop files to create a task"
                    testID="inline-add-task-file-drop-zone"
                >
                    {children}
                </CreateTaskFileDropZone>
            </View>
        </AppPopover>
    )
}

export default withSafePopover(InlineAddTaskFileDrop)
