import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'

import URLsGoals, { URL_PROJECT_USER_GOALS_DONE, URL_PROJECT_USER_GOALS_OPEN } from '../../URLSystem/Goals/URLsGoals'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import { GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import MilestonesListByProject from './MilestonesListByProject'
import { GoalsProjectWatcher } from './GoalsViewAllProjects'

const NOOP = () => {}

export default function GoalsViewSelectedProject({
    openEdition,
    closeEdition,
    unsetDismissibleRefs,
    setDismissibleRefs,
}) {
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const projectId = project.id
    const boardMilestones = useSelector(state => state.boardMilestonesByProject[projectId])

    const writeBrowserURL = () => {
        URLsGoals.push(
            goalsActiveTab === GOALS_OPEN_TAB_INDEX ? URL_PROJECT_USER_GOALS_OPEN : URL_PROJECT_USER_GOALS_DONE,
            null,
            projectId,
            currentUserId
        )
    }

    useEffect(() => {
        if (processedInitialURL && selectedSidebarTab === DV_TAB_ROOT_GOALS) writeBrowserURL()
    }, [processedInitialURL, projectId, selectedSidebarTab, goalsActiveTab, currentUserId])

    const firstMilestoneId = boardMilestones && boardMilestones.length > 0 ? boardMilestones[0].id : ''

    return (
        <>
            {currentUserId && (
                <GoalsProjectWatcher
                    project={project}
                    currentUserId={currentUserId}
                    trackInitialLoad
                    onInitialSnapshot={NOOP}
                />
            )}
            <MilestonesListByProject
                key={projectId + goalsActiveTab}
                projectId={projectId}
                projectIndex={selectedProjectIndex}
                goalsActiveTab={goalsActiveTab}
                firstMilestoneId={firstMilestoneId}
                setDismissibleRefs={setDismissibleRefs}
                unsetDismissibleRefs={unsetDismissibleRefs}
                closeEdition={closeEdition}
                openEdition={openEdition}
                canShowProject={true}
            />
        </>
    )
}
