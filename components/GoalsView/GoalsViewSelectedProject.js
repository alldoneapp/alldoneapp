import React, { useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import {
    setDoneMilestonesInProject,
    setGoalsInProject,
    setOpenMilestonesInProject,
    startLoadingData,
    stopLoadingData,
} from '../../redux/actions'
import URLsGoals, { URL_PROJECT_USER_GOALS_DONE, URL_PROJECT_USER_GOALS_OPEN } from '../../URLSystem/Goals/URLsGoals'
import Backend from '../../utils/BackendBridge'
import { watchAllGoals, watchAllMilestones } from '../../utils/backends/Goals/goalsFirestore'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import { getOwnerId, GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import MilestonesListByProject from './MilestonesListByProject'

export default function GoalsViewSelectedProject({
    openEdition,
    closeEdition,
    unsetDismissibleRefs,
    setDismissibleRefs,
}) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const projectId = useSelector(state => state.loggedUserProjects[selectedProjectIndex].id)
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

    useEffect(() => {
        if (currentUserId) {
            setTimeout(() => {
                dispatch(startLoadingData())
            }, 1)
            const watcherKey = v4()
            const ownerId = getOwnerId(projectId, currentUserId)

            watchAllMilestones(projectId, watcherKey, ownerId)
            return () => {
                Backend.unwatch(watcherKey)
                dispatch([
                    stopLoadingData(),
                    setOpenMilestonesInProject(projectId, null),
                    setDoneMilestonesInProject(projectId, null),
                ])
            }
        }
    }, [projectId, currentUserId])

    useEffect(() => {
        if (currentUserId) {
            setTimeout(() => {
                dispatch(startLoadingData())
            }, 1)
            const watcherKey = v4()
            const ownerId = getOwnerId(projectId, currentUserId)
            watchAllGoals(projectId, watcherKey, ownerId)
            return () => {
                Backend.unwatch(watcherKey)
                dispatch([stopLoadingData(), setGoalsInProject(projectId, null)])
            }
        }
    }, [projectId, currentUserId])

    const firstMilestoneId = boardMilestones && boardMilestones.length > 0 ? boardMilestones[0].id : ''

    return (
        <MilestonesListByProject
            key={projectId + goalsActiveTab}
            projectId={projectId}
            projectIndex={selectedProjectIndex}
            milestones={boardMilestones || []}
            goalsActiveTab={goalsActiveTab}
            firstMilestoneId={firstMilestoneId}
            setDismissibleRefs={setDismissibleRefs}
            unsetDismissibleRefs={unsetDismissibleRefs}
            closeEdition={closeEdition}
            openEdition={openEdition}
            canShowProject={true}
        />
    )
}
