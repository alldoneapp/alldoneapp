import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Header from './Header/Header'
import NavigationBar from '../NavigationBar/NavigationBar'
import {
    resetFloatPopup,
    setAssignee,
    setNavigationRoute,
    setScreenDimensions,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setTaskInDetailView,
    setShowAccessDeniedPopup,
    stopLoadingData,
    storeCurrentUser,
    unsetSharedMode,
    switchProject,
    navigateToAllProjectsTasks,
} from '../../redux/actions'
import store from '../../redux/store'
import PropertiesView from './Properties/PropertiesView'
import SubtasksView from './SubtasksView/SubtasksView'
import WorkflowEstimation from './Estimations/WorkflowEstimation'
import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import Backend from '../../utils/BackendBridge'
import BackButton from './Header/BackButton'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { useDispatch, useSelector } from 'react-redux'
import LoadingData from '../UIComponents/LoadingData'
import RootViewFeedsTask from '../Feeds/RootViewFeedsTask'
import NavigationService from '../../utils/NavigationService'
import CustomScrollView from '../UIControls/CustomScrollView'
import { LINKED_OBJECT_TYPE_TASK } from '../../utils/LinkingHelper'
import BacklinksView from '../BacklinksView/BacklinksView'
import SharedHelper from '../../utils/SharedHelper'
import TasksHelper, { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../TaskListView/Utils/TasksHelper'
import {
    DV_TAB_ROOT_TASKS,
    DV_TAB_TASK_BACKLINKS,
    DV_TAB_TASK_CHAT,
    DV_TAB_TASK_ESTIMATIONS,
    DV_TAB_TASK_PROPERTIES,
    DV_TAB_TASK_SUBTASKS,
    DV_TAB_TASK_UPDATES,
    DV_TAB_TASK_NOTE,
} from '../../utils/TabNavigationConstants'
import ChatBoard from '../ChatsView/ChatDV/ChatBoard'
import NoteIntegration from '../NoteIntegration/NoteIntegration'
import usePrivateProject from '../../hooks/usePrivateProject'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import GoldAnimationsContainer from '../RootView/GoldAnimationsContainer'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'

const TaskDetailedView = ({ navigation }) => {
    const dispatch = useDispatch()
    const projectId = navigation.getParam('projectId', undefined)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const loggedUser = useSelector(state => state.loggedUser)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const taskInDetailView = useSelector(state => state.taskInDetailView)
    const [isFullscreen, setFullscreen] = useState(false)
    const [task, setTask] = useState(navigation.getParam('task', undefined))
    usePrivateProject(projectId)
    const scrollRef = useRef()
    const isAssistant = task?.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    const { overlay } = useCollapsibleSidebar()

    const navigationTabs = [
        DV_TAB_TASK_PROPERTIES,
        DV_TAB_TASK_ESTIMATIONS,
        DV_TAB_TASK_SUBTASKS,
        DV_TAB_TASK_BACKLINKS,
        DV_TAB_TASK_NOTE,
        DV_TAB_TASK_CHAT,
        DV_TAB_TASK_UPDATES,
    ]

    const projectIndex = project.index

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    if (!accessGranted) {
        const indexBL = navigationTabs.indexOf(DV_TAB_TASK_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
    }

    if (isAssistant) {
        const indexBL = navigationTabs.indexOf(DV_TAB_TASK_SUBTASKS)
        navigationTabs.splice(indexBL, 1)
    }

    const afterAssigneeFetch = user => {
        user.uid = task.userId
        dispatch([setAssignee(user)])
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
        dispatch(setNavigationRoute('TaskDetailedView'))
    }, [])

    useEffect(() => {
        dispatch(setTaskInDetailView(task))

        TasksHelper.changeSharedMode(accessGranted)

        return () => {
            dispatch([setTaskInDetailView({}), unsetSharedMode()])
            Backend.offOnSingleTaskChange()
        }
    }, [selectedTab])

    useEffect(() => {
        Backend.getUserOrContactBy(projectId, task.userId).then(afterAssigneeFetch)
    }, [task.userId])

    useEffect(() => {
        if (taskInDetailView.name != null) {
            if (
                TasksHelper.isPrivateTask(taskInDetailView) ||
                objectIsLockedForUser(
                    projectId,
                    loggedUser.unlockedKeysByGuides,
                    taskInDetailView.lockKey,
                    taskInDetailView.userId
                )
            ) {
                NavigationService.navigate('Root')
                dispatch([
                    resetFloatPopup(),
                    setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                    stopLoadingData(),
                    setShowAccessDeniedPopup(true),
                ])
            } else {
                setTask(taskInDetailView)
            }
        }
    }, [selectedTab, taskInDetailView])

    useEffect(() => {
        if (selectedTab === DV_TAB_TASK_PROPERTIES) {
            setTimeout(() => scrollRef?.current?.scrollTo?.({ y: 0, animated: false }))
        } else if (selectedTab === DV_TAB_TASK_SUBTASKS && isAssistant) {
            dispatch(setSelectedNavItem(DV_TAB_TASK_PROPERTIES))
        }
    }, [selectedTab])

    useEffect(() => {
        Backend.offOnSingleTaskChange()
        Backend.onSingleTaskChange(projectId, task.id, afterTaskChange)
    }, [projectId, task.id])

    const afterTaskChange = task => {
        if (task == null) {
            const { selectedTypeOfProject } = store.getState()

            NavigationService.navigate('Root')
            if (selectedTypeOfProject === PROJECT_TYPE_SHARED) {
                dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
            } else {
                dispatch([
                    resetFloatPopup(),
                    setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                    stopLoadingData(),
                    setShowAccessDeniedPopup(true),
                ])
            }
        } else if (task !== null) {
            if (
                TasksHelper.isPrivateTask(task) ||
                objectIsLockedForUser(projectId, loggedUser.unlockedKeysByGuides, task.lockKey, task.userId)
            ) {
                if (loggedUser.isAnonymous) {
                    SharedHelper.redirectToPrivateResource()
                } else {
                    NavigationService.navigate('Root')
                    dispatch([
                        resetFloatPopup(),
                        setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                        stopLoadingData(),
                        setShowAccessDeniedPopup(true),
                    ])
                }
            } else {
                setTask(task)
                dispatch([setTaskInDetailView(task), stopLoadingData()])
            }
        }
    }

    const onLayout = ({ nativeEvent }) => {
        dispatch(setScreenDimensions(nativeEvent.layout))
    }
    const CustomView = selectedTab === DV_TAB_TASK_CHAT || selectedTab === DV_TAB_TASK_NOTE ? View : CustomScrollView

    const loggedUserIsTaskOwner = task.userId === loggedUser.uid
    const guideProject = ProjectHelper.getProjectById(projectId)
    const hideCreateNoteSection = !guideProject || (!!guideProject.parentTemplateId && !loggedUserIsTaskOwner)

    const linkedParentObject = {
        type: LINKED_OBJECT_TYPE_TASK,
        id: task.id,
        idsField: 'linkedParentTasksIds',
    }

    const projectCopy = project ? { ...project, id: projectId } : null

    return (
        <View style={localStyles.container} onLayout={onLayout}>
            <LoadingData />
            {((!loggedUser.isAnonymous && !smallScreenNavigation) ||
                (loggedUser.isAnonymous && smallScreenNavigation && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}
            <View style={{ flex: 1 }}>
                {!isMiddleScreen && accessGranted && (
                    <View style={[localStyles.backButton, overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH }]}>
                        <BackButton projectId={projectId} task={task} />
                    </View>
                )}
                <CustomView
                    ref={scrollRef}
                    style={[
                        localStyles.scrollPanel,
                        smallScreenNavigation
                            ? localStyles.scrollPanelMobile
                            : isMiddleScreen && localStyles.scrollPanelTablet,
                        overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                    ]}
                >
                    {!!projectCopy && !!projectId && (
                        <View style={{ flexDirection: 'column', backgroundColor: 'white', flex: 1 }}>
                            {(!isFullscreen || selectedTab !== DV_TAB_TASK_NOTE) && (
                                <Header
                                    projectId={projectId}
                                    task={task}
                                    navigation={navigation}
                                    isFullscreen={isFullscreen}
                                    setFullscreen={setFullscreen}
                                />
                            )}
                            <View style={{ flex: 1 }}>
                                {!isFullscreen && (
                                    <View style={smallScreenNavigation ? localStyles.navigationBar : undefined}>
                                        <NavigationBar isSecondary tabs={navigationTabs} />
                                    </View>
                                )}
                                {selectedTab === DV_TAB_TASK_PROPERTIES && (
                                    <PropertiesView project={projectCopy} task={task} loggedUser={loggedUser} />
                                )}
                                {selectedTab === DV_TAB_TASK_ESTIMATIONS && (
                                    <WorkflowEstimation projectId={projectId} task={task} />
                                )}
                                {selectedTab === DV_TAB_TASK_SUBTASKS && (
                                    <SubtasksView projectId={projectId} projectIndex={projectIndex} task={task} />
                                )}
                                {selectedTab === DV_TAB_TASK_BACKLINKS && (
                                    <BacklinksView
                                        project={projectCopy}
                                        linkedParentObject={linkedParentObject}
                                        externalStyle={{ marginHorizontal: 0 }}
                                    />
                                )}
                                {selectedTab === DV_TAB_TASK_NOTE && (
                                    <NoteIntegration
                                        project={projectCopy}
                                        noteId={task.noteId}
                                        objectId={task.id}
                                        object={task}
                                        objectName={task.extendedName}
                                        objectPrivacy={task.isPublicFor}
                                        isFullscreen={isFullscreen}
                                        setFullscreen={setFullscreen}
                                        objectType="tasks"
                                        hideCreateNoteSection={hideCreateNoteSection}
                                        creatorId={task.creatorId}
                                    />
                                )}
                                {selectedTab === DV_TAB_TASK_CHAT && (
                                    <ChatBoard
                                        chat={{ id: task.id, type: 'tasks' }}
                                        projectId={projectId}
                                        chatTitle={task.name}
                                        assistantId={task.assistantId}
                                        objectType={'tasks'}
                                        parentObject={task}
                                    />
                                )}
                                {selectedTab === DV_TAB_TASK_UPDATES && (
                                    <RootViewFeedsTask projectId={projectId} taskId={task.id} task={task} />
                                )}
                            </View>
                        </View>
                    )}
                </CustomView>
            </View>

            {!smallScreenNavigation && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
            <GoldAnimationsContainer />
        </View>
    )
}

export default TaskDetailedView

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
    },
    backButton: {
        position: 'absolute',
        top: 0,
        left: 32,
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
