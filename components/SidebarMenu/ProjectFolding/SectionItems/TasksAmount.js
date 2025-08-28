import React from 'react'
import { useSelector } from 'react-redux'

import AmountBadge from '../Common/AmountBadge'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function TasksAmount({ projectId, projectSelected, selected, lowSelected }) {
    const { expanded } = useCollapsibleSidebar()

    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const sidebarNumbers = useSelector(state => state.sidebarNumbers)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)

    const getTaskAmount = () => {
        if (projectId && projectSelected && checkIfSelectedProject(selectedProjectIndex)) {
            return 0
        } else if (checkIfSelectedAllProjects(selectedProjectIndex)) {
            let taskAmountAllProjects = 0
            for (let pId in sidebarNumbers) {
                if (
                    sidebarNumbers[pId][loggedUserId] &&
                    !templateProjectIds.includes(pId) &&
                    !archivedProjectIds.includes(pId)
                ) {
                    taskAmountAllProjects += sidebarNumbers[pId][loggedUserId]
                }
            }
            return taskAmountAllProjects
        } else if (projectId && sidebarNumbers[projectId]?.[loggedUserId]) {
            return sidebarNumbers[projectId][loggedUserId]
        }

        return 0
    }

    const amount = getTaskAmount()

    return amount > 0 && (expanded || selected) && <AmountBadge amount={amount} highlight={selected || lowSelected} />
}
