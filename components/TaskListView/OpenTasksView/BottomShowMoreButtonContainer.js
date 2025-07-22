import React from 'react'
import { useSelector } from 'react-redux'

import BottomShowMoreButton from './BottomShowMoreButton'

export default function BottomShowMoreButtonContainer({ instanceKey, projectIndex, setProjectsHaveTasksInFirstDay }) {
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex].id)
    const somedayTasksExpanded = useSelector(state => state.somedayTasksExpanded)
    const somedayGoalsExpanded = useSelector(state => state.somedayGoalsExpanded)

    const filteredOpenTasksStoreLength = useSelector(state =>
        state.filteredOpenTasksStore[instanceKey] ? state.filteredOpenTasksStore[instanceKey].length : 0
    )

    const showBottomShowMoreButton = (somedayTasksExpanded || somedayGoalsExpanded) && filteredOpenTasksStoreLength > 1

    return showBottomShowMoreButton ? (
        <BottomShowMoreButton
            instanceKey={instanceKey}
            projectId={projectId}
            setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
        />
    ) : null
}
