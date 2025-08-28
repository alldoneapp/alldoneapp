import React from 'react'
import { useSelector } from 'react-redux'

import ModalItem from '../Common/ModalItem'
import { updateFocusedTask } from '../../../../../utils/backends/Tasks/tasksFirestore'

export default function InFocusModalItem({ shortcut, projectId, taskId, closeModal, task }) {
    const loggedUser = useSelector(state => state.loggedUser)

    const active = loggedUser.inFocusTaskId === taskId

    const focusTask = () => {
        updateFocusedTask(loggedUser.uid, projectId, active ? null : task, null, null)
        closeModal?.()
    }

    return (
        <ModalItem
            icon={'crosshair'}
            text={active ? 'Set out of focus' : 'Set in focus'}
            shortcut={shortcut}
            onPress={focusTask}
        />
    )
}
