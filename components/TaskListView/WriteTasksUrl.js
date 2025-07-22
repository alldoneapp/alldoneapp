import { useEffect } from 'react'
import { useSelector } from 'react-redux'

import TasksHelper from './Utils/TasksHelper'

export default function WriteTasksUrl() {
    const currentSection = useSelector(state => state.taskViewToggleSection)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)

    useEffect(() => {
        if (processedInitialURL) TasksHelper.setURLOnChangeToggleOption(taskViewToggleIndex, currentSection)
    }, [processedInitialURL, selectedProjectIndex, currentUserId])

    return null
}
