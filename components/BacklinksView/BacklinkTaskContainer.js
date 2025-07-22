import React, { useState, useEffect } from 'react'
import ParentTaskContainer from '../TaskListView/ParentTaskContainer'
import Backend from '../../utils/BackendBridge'

export default function BacklinkTaskContainer({ task, projectId }) {
    const [subtaskList, setSubtaskList] = useState([])
    useEffect(() => {
        Backend.watchSubtasksList(projectId, task.id, setSubtaskList)
        return () => {
            Backend.unwatchSubtasksList(task.id)
        }
    }, [])
    return (
        <ParentTaskContainer
            key={task.id}
            task={task}
            projectId={projectId}
            subtaskList={subtaskList ? subtaskList : []}
        />
    )
}
