import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import NavigationBar from '../NavigationBar/NavigationBar'
import Header from './Header/Header'
import BackButton from './Header/BackButton'
import {
    navigateToAllProjectsTasks,
    resetFloatPopup,
    setNavigationRoute,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
    switchProject,
} from '../../redux/actions'
import store from '../../redux/store'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import CustomScrollView from '../UIControls/CustomScrollView'
import {
    DV_TAB_GOAL_BACKLINKS,
    DV_TAB_GOAL_CHAT,
    DV_TAB_GOAL_PROPERTIES,
    DV_TAB_GOAL_UPDATES,
    DV_TAB_GOAL_LINKED_TASKS,
    DV_TAB_GOAL_NOTE,
    DV_TAB_ROOT_GOALS,
} from '../../utils/TabNavigationConstants'
import Backend from '../../utils/BackendBridge'
import GoalProperties from './GoalProperties/GoalProperties'
import RootViewFeedsGoal from '../Feeds/RootViewFeedsGoal'
import BacklinksView from '../BacklinksView/BacklinksView'
import { LINKED_OBJECT_TYPE_GOAL } from '../../utils/LinkingHelper'
import SharedHelper from '../../utils/SharedHelper'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import GoalTasksView from './TasksView/GoalTasksView'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import NavigationService from '../../utils/NavigationService'
import usePrivateProject from '../../hooks/usePrivateProject'
import DragModalsContainer from '../UIComponents/FloatModals/DragModalsContainer'
import GoldAnimationsContainer from '../RootView/GoldAnimationsContainer'
import DueDateSinglePopup from '../UIComponents/DueDateSinglePopup'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'

export default function GoalDetailedView({ navigation }) {
    const projectId = navigation.getParam('projectId', undefined)
    const goalId = navigation.getParam('goalId', undefined)
    const initialGoal = navigation.getParam('goal', undefined)

    const dispatch = useDispatch()
    const showSwipeDueDatePopup = useSelector(state => state.showSwipeDueDatePopup.visible)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [goal, setGoal] = useState(initialGoal ? initialGoal : null)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const [isFullscreen, setFullscreen] = useState(false)
    usePrivateProject(projectId)

    const { overlay } = useCollapsibleSidebar()

    const navigationTabs = [
        DV_TAB_GOAL_PROPERTIES,
        DV_TAB_GOAL_LINKED_TASKS,
        DV_TAB_GOAL_BACKLINKS,
        DV_TAB_GOAL_NOTE,
        DV_TAB_GOAL_CHAT,
        DV_TAB_GOAL_UPDATES,
    ]

    const projectIndex = ProjectHelper.getProjectIndexById(projectId)

    if (!accessGranted) {
        const indexBL = navigationTabs.indexOf(DV_TAB_GOAL_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
    }

    const redirectOut = showAccessDeniedModal => {
        if (loggedUser.isAnonymous) {
            SharedHelper.redirectToPrivateResource()
        } else {
            const { selectedTypeOfProject } = store.getState()
            NavigationService.navigate('Root')
            if (selectedTypeOfProject === PROJECT_TYPE_SHARED) {
                dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
            } else {
                const actionsToDispatch = [
                    resetFloatPopup(),
                    setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
                    stopLoadingData(),
                ]
                if (showAccessDeniedModal) actionsToDispatch.push(setShowAccessDeniedPopup(true))
                dispatch(actionsToDispatch)
            }
        }
    }

    const checkIfIsPrivateGoal = goal => {
        const isPrivateForUser =
            !goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) &&
            (loggedUser.isAnonymous || !goal.isPublicFor.includes(loggedUser.uid))

        return isPrivateForUser
    }

    const updateGoal = goalUpdated => {
        if (goalUpdated) {
            const isPrivateForUser = checkIfIsPrivateGoal(goalUpdated)
            isPrivateForUser ||
            objectIsLockedForUser(projectId, loggedUser.unlockedKeysByGuides, goalUpdated.lockKey, goalUpdated.ownerId)
                ? redirectOut(true)
                : setGoal(goalUpdated)
        } else {
            redirectOut(false)
        }
    }

    useEffect(() => {
        const { currentUser, loggedUser } = store.getState()
        if (!!currentUser.recorderUserId || !!currentUser.temperature) {
            dispatch(storeCurrentUser(loggedUser))
        }
    }, [])

    useEffect(() => {
        setFullscreen(assistantEnabled)
    }, [assistantEnabled])

    useEffect(() => {
        if (goal) {
            const isPrivateForUser = checkIfIsPrivateGoal(goal)
            if (
                isPrivateForUser ||
                objectIsLockedForUser(projectId, loggedUser.unlockedKeysByGuides, goal.lockKey, goal.ownerId)
            )
                redirectOut(true)
        }
    }, [])

    useEffect(() => {
        const watcherKey = v4()
        Backend.watchGoal(projectId, goalId, watcherKey, updateGoal)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [projectId, goalId])

    useEffect(() => {
        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
        dispatch([switchProject(projectIndex), setSelectedTypeOfProject(projectType)])
    }, [])

    useEffect(() => {
        dispatch(setNavigationRoute('GoalDetailedView'))
    }, [])

    useEffect(() => {
        const tab = navigationTabs.includes(selectedNavItem) ? selectedNavItem : DV_TAB_GOAL_PROPERTIES
        TasksHelper.changeSharedMode(accessGranted)
        dispatch(setSelectedNavItem(tab))
    }, [selectedNavItem])

    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_GOAL,
        id: goalId,
        idsField: 'linkedParentGoalsIds',
    }

    const project = ProjectHelper.getProjectById(projectId)
    const CustomView =
        selectedNavItem === DV_TAB_GOAL_NOTE || selectedNavItem === DV_TAB_GOAL_CHAT ? View : CustomScrollView

    const loggedUserIsGoalOwner = goal && goal.ownerId === loggedUser.uid
    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    const hideCreateNoteSection = isGuide && !loggedUserIsGoalOwner
    return (
        <View style={localStyles.container}>
            {((!loggedUser.isAnonymous && !smallScreenNavigation) ||
                (loggedUser.isAnonymous && smallScreenNavigation && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}

            {goal && (
                <View style={{ flex: 1 }}>
                    {!isMiddleScreen && accessGranted && <BackButton projectId={projectId} goal={goal} />}

                    <CustomView
                        style={[
                            localStyles.scrollPanel,
                            smallScreenNavigation
                                ? localStyles.scrollPanelMobile
                                : isMiddleScreen && localStyles.scrollPanelTablet,
                            overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                        ]}
                    >
                        <View style={{ backgroundColor: 'white', flex: 1 }}>
                            {(!isFullscreen || selectedNavItem !== DV_TAB_GOAL_NOTE) && (
                                <Header
                                    projectIndex={projectIndex}
                                    goal={goal}
                                    projectId={projectId}
                                    accessGranted={accessGranted}
                                    navigation={navigation}
                                    isFullscreen={isFullscreen}
                                    setFullscreen={setFullscreen}
                                />
                            )}
                            <View style={{ flex: 1 }}>
                                {!isFullscreen && (
                                    <View style={smallScreenNavigation ? localStyles.navigationBar : undefined}>
                                        <NavigationBar
                                            taskDetail
                                            isSecondary
                                            tabs={navigationTabs}
                                            style={{ height: 56 }}
                                        />
                                    </View>
                                )}
                                {(() => {
                                    switch (selectedNavItem) {
                                        case DV_TAB_GOAL_PROPERTIES:
                                            return (
                                                <GoalProperties
                                                    projectId={projectId}
                                                    goal={goal}
                                                    accessGranted={accessGranted}
                                                />
                                            )
                                        case DV_TAB_GOAL_LINKED_TASKS:
                                            return <GoalTasksView projectId={projectId} goal={goal} />
                                        case DV_TAB_GOAL_UPDATES:
                                            return (
                                                <RootViewFeedsGoal projectId={projectId} goal={goal} goalId={goalId} />
                                            )
                                        case DV_TAB_GOAL_BACKLINKS:
                                            return (
                                                <BacklinksView
                                                    project={project}
                                                    linkedParentObject={linkedParentObject}
                                                    externalStyle={{ marginHorizontal: 0 }}
                                                />
                                            )
                                        case DV_TAB_GOAL_CHAT:
                                            return (
                                                <ChatBoard
                                                    chat={{ id: goal.id, type: 'goals' }}
                                                    projectId={project.id}
                                                    chatTitle={goal.name}
                                                    assistantId={goal.assistantId}
                                                    objectType={'goals'}
                                                />
                                            )
                                        case DV_TAB_GOAL_NOTE:
                                            return (
                                                <NoteIntegration
                                                    project={project}
                                                    noteId={goal.noteId}
                                                    objectId={goalId}
                                                    objectName={goal.extendedName}
                                                    objectPrivacy={goal.isPublicFor}
                                                    isFullscreen={isFullscreen}
                                                    setFullscreen={setFullscreen}
                                                    objectType="goals"
                                                    hideCreateNoteSection={hideCreateNoteSection}
                                                    object={goal}
                                                    creatorId={goal.creatorId}
                                                />
                                            )
                                    }
                                })()}
                            </View>
                        </View>
                    </CustomView>
                    <DragModalsContainer />
                </View>
            )}

            {!smallScreenNavigation && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
            {showSwipeDueDatePopup && <DueDateSinglePopup />}
            <GoldAnimationsContainer />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
    },
    backButton: {
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 100,
    },
    scrollPanel: {
        flex: 1,
        flexDirection: 'column',
        backgroundColor: 'white',
        paddingHorizontal: 104,
    },
    scrollPanelMobile: {
        paddingHorizontal: 16,
    },
    scrollPanelTablet: {
        paddingHorizontal: 56,
    },
    navigationBar: {
        marginHorizontal: -16,
    },
})
