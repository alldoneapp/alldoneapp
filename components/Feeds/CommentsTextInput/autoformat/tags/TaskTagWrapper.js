import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import TaskTag from '../../../../Tags/TaskTag'
import { exportRef } from '../../../../NotesView/NotesDV/EditorView/NotesEditorView'
import { quillTextInputRefs } from '../../CustomTextInput3'
import { getQuillEditorRef } from '../../textInputHelper'
import ManageTaskModal from '../../../../UIComponents/FloatModals/ManageTaskModal/ManageTaskModal'
import RemovedTaskModal from '../../../../UIComponents/FloatModals/ManageTaskModal/RemovedTaskModal'
import { exitsOpenModals, MANAGE_TASK_MODAL_ID, storeModal } from '../../../../ModalsManager/modalsManager'
import SharedHelper from '../../../../../utils/SharedHelper'
import { popoverToCenter } from '../../../../../utils/HelperFunctions'
import Backend from '../../../../../utils/BackendBridge'
import { setTaskDueDate } from '../../../../../utils/backends/Tasks/tasksFirestore'

export const MISSING_TASK_RECOVERY_DELAY = 250

export const selectTaskTagProjectId = (state, editorId) =>
    state.quillTextInputProjectIdsByEditorId[editorId] || state.quillEditorProjectId

export const selectTaskForEditor = (state, editorId, taskId) => {
    const editorTasks = state.notesInnerTasks[editorId]
    if (editorTasks?.[taskId]) return editorTasks[taskId]

    // Older copied embeds can still carry the id of the note they came from. Keep the active-note
    // lookup as a compatibility fallback, but never make a correctly scoped embed depend on that
    // global value: it can be cleared while note/editor views are being swapped.
    const activeNoteTasks = state.notesInnerTasks[state.activeNoteId]
    return activeNoteTasks?.[taskId] || null
}

export default function TaskTagWrapper({
    taskId,
    editorId,
    tagId,
    setModalHeight,
    objectUrl,
    loadTask = Backend.getTaskData,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectId = useSelector(state => selectTaskTagProjectId(state, editorId))
    const loggedUser = useSelector(state => state.loggedUser)
    const taskFromRedux = useSelector(state => selectTaskForEditor(state, editorId, taskId))

    const activeNoteIsReadOnly = useSelector(state => state.activeNoteIsReadOnly)
    const { editorRef } = getQuillEditorRef(exportRef, quillTextInputRefs, editorId)
    const [isOpen, setIsOpen] = useState(!taskId)
    const [deletedTaskId, setDeletedTaskId] = useState(null)
    const [recoveredTask, setRecoveredTask] = useState(null)
    const lastTaskRef = useRef({ taskId: null, task: null })

    if (lastTaskRef.current.taskId !== taskId) lastTaskRef.current = { taskId, task: null }
    if (taskFromRedux) lastTaskRef.current = { taskId, task: taskFromRedux }
    // The note toolbar renders this wrapper with NO taskId to create a task (see the call sites in
    // DvContainer/NoteIntegration), so `taskId` is legitimately undefined here. Guard on the
    // recovered record itself: `recoveredTask?.taskId === taskId` is TRUE when both sides are
    // undefined, which then dereferenced a null `recoveredTask` and crashed the editor (AT-2428).
    const recoveredTaskForId = recoveredTask && recoveredTask.taskId === taskId ? recoveredTask.task : null
    const taskToRender = taskFromRedux || recoveredTaskForId || lastTaskRef.current.task
    const isDeleted = deletedTaskId === taskId

    useEffect(() => {
        if (taskFromRedux) {
            setRecoveredTask(null)
            setDeletedTaskId(null)
            return
        }
        if (!taskId || !projectId) return

        // A note's aggregate query can briefly (or, after a listener race, indefinitely) omit an
        // existing task while it moves to Done. Keep the last good row visible and verify the task
        // directly. The direct read also lets a genuinely deleted task render its explicit removed
        // state instead of leaving an empty inline embed forever.
        let cancelled = false
        const recoveryTimeout = setTimeout(async () => {
            try {
                const task = await loadTask(projectId, taskId)
                if (cancelled) return
                if (task) {
                    lastTaskRef.current = { taskId, task }
                    setRecoveredTask({ taskId, task })
                    setDeletedTaskId(null)
                } else {
                    lastTaskRef.current = { taskId, task: null }
                    setRecoveredTask(null)
                    setDeletedTaskId(taskId)
                }
            } catch (error) {
                // Preserve the last known task while offline or reconnecting. The aggregate note
                // listener remains the primary source and will replace it as soon as it recovers.
            }
        }, MISSING_TASK_RECOVERY_DELAY)

        return () => {
            cancelled = true
            clearTimeout(recoveryTimeout)
        }
    }, [loadTask, projectId, taskFromRedux, taskId])

    const openModal = () => {
        if (!isOpen) {
            storeModal(MANAGE_TASK_MODAL_ID, { inTag: true, fromUrlTag: { [taskId]: 1 } })
            setIsOpen(true)
        }
    }

    const closeModal = forecedAction => {
        if (forecedAction === 'close' || !exitsOpenModals([MANAGE_TASK_MODAL_ID])) {
            setIsOpen(false)
        }
    }

    const updateTaskDueDateFromTag = (taskObjectFromModal, actualDateTimestamp, actualIsObserved) => {
        if (taskToRender && projectId) {
            setTaskDueDate(projectId, taskToRender.id, actualDateTimestamp, taskToRender, actualIsObserved, null)
        }
    }

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <AppPopover
            content={
                isDeleted ? (
                    <RemovedTaskModal closeModal={closeModal} />
                ) : (
                    <ManageTaskModal
                        projectId={projectId}
                        setModalHeight={setModalHeight}
                        closeModal={closeModal}
                        editorRef={editorRef}
                        noteId={editorId}
                        editing={taskId}
                        task={taskToRender}
                        tagId={tagId}
                        unwatchTask={() => {}}
                        objectUrl={objectUrl}
                    />
                )
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={args => popoverToCenter(args, mobile)}
            // contentLocation={contentLocation ? contentLocation : null}
        >
            {taskId ? (
                <TaskTag
                    editorId={editorId}
                    isDeleted={isDeleted}
                    taskId={taskId}
                    task={taskToRender}
                    onPress={openModal}
                    projectId={projectId}
                    disabled={!accessGranted || isOpen || activeNoteIsReadOnly}
                    isLoading={!taskToRender && !isDeleted}
                    saveDueDateCallback={updateTaskDueDateFromTag}
                />
            ) : (
                <View />
            )}
        </AppPopover>
    )
}
