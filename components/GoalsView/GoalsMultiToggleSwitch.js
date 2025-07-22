import React from 'react'
import { useSelector } from 'react-redux'

import GoalsMultiToggleSwitchSelectedProject from './GoalsMultiToggleSwitchSelectedProject'
import GoalsMultiToggleSwitchAllProjects from './GoalsMultiToggleSwitchAllProjects'

export default function GoalsMultiToggleSwitch() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    return selectedProjectIndex < 0 ? <GoalsMultiToggleSwitchAllProjects /> : <GoalsMultiToggleSwitchSelectedProject />
}
