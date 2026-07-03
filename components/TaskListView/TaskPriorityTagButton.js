import React, { useState } from 'react'
import { TouchableOpacity } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { setTaskPriority } from '../../utils/backends/Tasks/tasksFirestore'
import { normalizeTaskPriority, TASK_PRIORITY_NONE } from '../../utils/TaskPriority'
import TaskPriorityModal from '../UIComponents/FloatModals/TaskPriorityModal/TaskPriorityModal'
import TaskPriorityTag from '../Tags/TaskPriorityTag'

// Clickable version of the task list priority chip. It reuses the same selector
// (TaskPriorityModal) and update helper (setTaskPriority) as the detailed view, so
// picking a priority here behaves exactly like doing it on the task detail page.
export default function TaskPriorityTagButton({ task, projectId, disabled, style }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    // No tag is rendered for tasks without a priority, so there is nothing to open.
    if (normalizeTaskPriority(task.priority) === TASK_PRIORITY_NONE) return null

    // Keep the plain, non-interactive chip when editing is not allowed.
    if (disabled) return <TaskPriorityTag priority={task.priority} style={style} />

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <TaskPriorityModal
                    priority={task.priority}
                    setPriority={priority => setTaskPriority(projectId, task, priority)}
                    closeModal={closeModal}
                />
            }
            align={'end'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            padding={4}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity onPress={openModal} activeOpacity={0.8}>
                <TaskPriorityTag priority={task.priority} style={style} />
            </TouchableOpacity>
        </Popover>
    )
}
