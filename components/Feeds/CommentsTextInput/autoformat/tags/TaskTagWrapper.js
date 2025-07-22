import React, { useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
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
import { setTaskDueDate } from '../../../../../utils/backends/Tasks/tasksFirestore'

export default function TaskTagWrapper({ taskId, editorId, tagId, setModalHeight, objectUrl }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectId = useSelector(state => state.quillEditorProjectId)
    const loggedUser = useSelector(state => state.loggedUser)
    const activeNoteId = useSelector(state => state.activeNoteId)
    const taskFromRedux = useSelector(state => {
        const innerTasks = state.notesInnerTasks[activeNoteId]
        return innerTasks ? innerTasks[taskId] : null
    })

    const activeNoteIsReadOnly = useSelector(state => state.activeNoteIsReadOnly)
    const { editorRef } = getQuillEditorRef(exportRef, quillTextInputRefs, editorId)
    const [isOpen, setIsOpen] = useState(!taskId)
    const [isDeleted, setIsDeleted] = useState(false)

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
        if (taskFromRedux && projectId) {
            setTaskDueDate(projectId, taskFromRedux.id, actualDateTimestamp, taskFromRedux, actualIsObserved, null)
        }
    }

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <Popover
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
                        task={taskFromRedux}
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
                    activeNoteId={activeNoteId}
                    isDeleted={isDeleted}
                    taskId={taskId}
                    task={taskFromRedux}
                    onPress={openModal}
                    projectId={projectId}
                    disabled={!accessGranted || isOpen || activeNoteIsReadOnly}
                    isLoading={!taskFromRedux && !isDeleted}
                    saveDueDateCallback={updateTaskDueDateFromTag}
                />
            ) : (
                <View />
            )}
        </Popover>
    )
}
