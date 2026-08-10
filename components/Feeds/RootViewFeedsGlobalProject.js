import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import HeaderGlobalProject from './HeaderGlobalProject'
import GlobalProject from './GlobalProject'
import { useDispatch, useSelector } from 'react-redux'
import ProjectHelper, {
    ALL_PROJECTS_INDEX,
    checkIfSelectedProject,
} from '../SettingsView/ProjectsSettings/ProjectHelper'
import URLSystem from '../../URLSystem/URLSystem'
import { getURLConstantByFollowedState } from './Utils/HelperFunctions'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_GUIDE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import { setReloadGlobalFeeds, updateFeedActiveTab } from '../../redux/actions'
import { FOLLOWED_TAB, ALL_TAB } from './Utils/FeedsConstants'

import { HISTORICAL_MODE, LOADING_MODE, NEW_FEEDS_MODE } from './Utils/FeedsHelper'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'

export default function RootViewFeedsGlobalProject() {
    const dispatch = useDispatch()
    const followedAmount = useSelector(state => state.followedFeedsAmount)
    const allAmount = useSelector(state => state.allFeedsAmount)
    const feedActiveTab = useSelector(state => state.feedActiveTab)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUser = useSelector(state => state.loggedUser)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const needReloadGlobalFeeds = useSelector(state => state.needReloadGlobalFeeds)
    const loadedNewFeeds = useSelector(state => state.loadedNewFeeds)

    const [amountFollowedFeeds, setAmountFollowedFeeds] = useState(0)
    const [amountAllFeeds, setAmountAllFeeds] = useState(0)

    const [amountNewFeedsProjects, setAmountNewFeedsProjects] = useState({})
    const [sortedProjects, setSortedProjects] = useState([])
    const [isFirstRender, setIsFirstRender] = useState(true)

    const [globalActiveMode, setGlobalActiveMode] = useState(LOADING_MODE)

    const isProjectSelected = checkIfSelectedProject(selectedProjectIndex)
    const project = isProjectSelected ? loggedUserProjects[selectedProjectIndex] : ALL_PROJECTS_INDEX

    const activeFeedTab = followedAmount === 0 && allAmount > 0 ? ALL_TAB : FOLLOWED_TAB

    const onChangeActiveFeedTab = () => {
        let projectId = isProjectSelected ? loggedUserProjects[selectedProjectIndex].id : ALL_PROJECTS_INDEX
        const constant = getURLConstantByFollowedState(feedActiveTab, !isProjectSelected)
        URLSystem.push(constant, { projectId }, projectId, loggedUser.uid)
    }

    const calculateTotalNewFeedAmount = () => {
        let newTotalAmount = 0
        for (let i = 0; i < sortedProjects.length; i++) {
            if (amountNewFeedsProjects[sortedProjects[i].id]) {
                newTotalAmount += amountNewFeedsProjects[sortedProjects[i].id]
            }
        }
        feedActiveTab === FOLLOWED_TAB ? setAmountFollowedFeeds(newTotalAmount) : setAmountAllFeeds(newTotalAmount)
    }

    useEffect(() => {
        calculateTotalNewFeedAmount()
    }, [amountNewFeedsProjects, sortedProjects])

    // Functional update: every mounted project reports its amount independently and the previous
    // version captured a stale `amountNewFeedsProjects`, so concurrent reports overwrote each other.
    // Bailing out when the value is unchanged also stops the render-phase call in GlobalProject from
    // re-rendering the whole page once per project while it loads.
    const updateProjectNewFeedAmount = useCallback((projectId, newAmount) => {
        setAmountNewFeedsProjects(currentAmounts =>
            currentAmounts[projectId] === newAmount ? currentAmounts : { ...currentAmounts, [projectId]: newAmount }
        )
    }, [])

    useEffect(() => {
        onChangeActiveFeedTab()
    }, [feedActiveTab, selectedProjectIndex])

    useEffect(() => {
        feedActiveTab === FOLLOWED_TAB ? setAmountAllFeeds(allAmount) : setAmountFollowedFeeds(followedAmount)
    }, [followedAmount, allAmount])

    useEffect(() => {
        const normalProjects = ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, PROJECT_TYPE_ACTIVE)
        const guideProjects = ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, PROJECT_TYPE_GUIDE)

        normalProjects.sort((a, b) =>
            a.lastActionDate < b.lastActionDate ? 1 : b.lastActionDate < a.lastActionDate ? -1 : 0
        )
        guideProjects.sort((a, b) =>
            a.lastActionDate < b.lastActionDate ? 1 : b.lastActionDate < a.lastActionDate ? -1 : 0
        )
        setSortedProjects([...normalProjects, ...guideProjects])
    }, [loggedUserProjects, selectedProjectIndex])

    useEffect(() => {
        if (processedInitialURL && needReloadGlobalFeeds) {
            if (isFirstRender) {
                setIsFirstRender(false)
            } else {
                activeFeedTab === FOLLOWED_TAB ? setAmountAllFeeds(0) : setAmountFollowedFeeds(0)
            }
            dispatch([updateFeedActiveTab(activeFeedTab), setReloadGlobalFeeds(false)])
        }
    }, [needReloadGlobalFeeds])

    useEffect(() => {
        if (loadedNewFeeds) {
            const amountNewFeeds = feedActiveTab === FOLLOWED_TAB ? followedAmount : allAmount
            amountNewFeeds > 0 ? setGlobalActiveMode(NEW_FEEDS_MODE) : setGlobalActiveMode(HISTORICAL_MODE)
        }
    }, [loadedNewFeeds, feedActiveTab, selectedProjectIndex])

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            <HeaderGlobalProject
                smallScreenNavigation={smallScreenNavigation}
                setAmountFollowedFeeds={setAmountFollowedFeeds}
                setAmountAllFeeds={setAmountAllFeeds}
                amountFollowedFeeds={amountFollowedFeeds}
                amountAllFeeds={amountAllFeeds}
                projectId={project?.id}
                selectedUser={loggedUser}
            />

            <HashtagFiltersView />

            {selectedProjectIndex < 0 ? (
                sortedProjects.map((project, index) => {
                    const projectId = project.id
                    return (
                        <GlobalProject
                            key={projectId}
                            project={project}
                            feedActiveTab={feedActiveTab}
                            updateProjectNewFeedAmount={updateProjectNewFeedAmount}
                            amountNewFeeds={amountNewFeedsProjects[project.id]}
                            globalActiveMode={globalActiveMode}
                            feedsUserId={loggedUser.uid}
                            projectId={projectId}
                        />
                    )
                })
            ) : (
                <GlobalProject
                    project={loggedUserProjects[selectedProjectIndex]}
                    feedActiveTab={feedActiveTab}
                    updateProjectNewFeedAmount={updateProjectNewFeedAmount}
                    amountNewFeeds={amountNewFeedsProjects[loggedUserProjects[selectedProjectIndex].id]}
                    globalActiveMode={HISTORICAL_MODE}
                    feedsUserId={loggedUser.uid}
                    projectId={loggedUserProjects[selectedProjectIndex].id}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 104,
        marginBottom: 8,
    },
    containerMobile: {
        paddingHorizontal: 16,
    },
    containerTablet: {
        paddingHorizontal: 56,
    },
})
