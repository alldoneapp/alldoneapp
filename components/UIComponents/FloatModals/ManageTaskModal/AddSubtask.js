import React, { useState, useEffect } from 'react'

import AddSubtaskPresentation from './AddSubtaskPresentation'
import TaskEditionMode from './TaskEditionMode'

export default function AddSubtask({ projectId, parentTask, taskBeenEdited, setTaskBeenEdited, closeModal }) {
    const [inEditionMode, setInEditionMode] = useState(false)

    const toggleEditionMode = () => {
        setTaskBeenEdited(inEditionMode ? '' : 'ADD_SUBTASK')
        setInEditionMode(!inEditionMode)
    }

    useEffect(() => {
        if (taskBeenEdited !== 'ADD_SUBTASK') {
            setInEditionMode('')
        }
    }, [taskBeenEdited])

    return inEditionMode ? (
        <TaskEditionMode
            projectId={projectId}
            parentTask={parentTask}
            closeModal={closeModal}
            toggleEditionMode={toggleEditionMode}
            isSubtask={true}
        />
    ) : (
        <AddSubtaskPresentation toggleEditionMode={toggleEditionMode} disabled={false} />
    )
}
