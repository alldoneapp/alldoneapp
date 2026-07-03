import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { setTaskPriority } from '../../../../utils/backends/Tasks/tasksFirestore'
import TaskPriorityButton from './TaskPriorityButton'
import TaskPriorityModal from './TaskPriorityModal'

export default function TaskPriorityWrapper({ projectId, task, disabled }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

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
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TaskPriorityButton priority={task.priority} disabled={disabled} onPress={openModal} />
        </Popover>
    )
}
