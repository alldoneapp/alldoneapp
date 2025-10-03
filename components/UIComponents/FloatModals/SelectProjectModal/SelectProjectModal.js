import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { findIndex } from 'lodash'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import ProjectModalItem from './ProjectModalItem'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import URLsTasks, { URL_TASK_DETAILS_PROPERTIES } from '../../../../URLSystem/Tasks/URLsTasks'
import Backend from '../../../../utils/BackendBridge'
import {
    blockBackgroundTabShortcut,
    hideProjectPicker,
    setAssignee,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    startLoadingData,
    stopLoadingData,
    switchProject,
    unblockBackgroundTabShortcut,
} from '../../../../redux/actions'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import { applyPopoverWidth, dismissAllPopups, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import {
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_SKILL_PROPERTIES,
    DV_TAB_TASK_PROPERTIES,
} from '../../../../utils/TabNavigationConstants'
import useWindowSize from '../../../../utils/useWindowSize'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_ARCHIVED } from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import Header, { PROJECT_MODAL_ACTIVE_TAB, PROJECT_MODAL_ARCHIVED_TAB } from './Header'
import NavigationService from '../../../../utils/NavigationService'
import EmptyResults from '../EmptyResults'
import { DEFAULT_WORKSTREAM_ID } from '../../../Workstreams/WorkstreamHelper'
import { translate } from '../../../../i18n/TranslationService'
import { setTaskAssignee, setTaskProject } from '../../../../utils/backends/Tasks/tasksFirestore'
import { setNoteProject } from '../../../../utils/backends/Notes/notesFirestore'
import { moveChatOnMoveObjectFromProject } from '../../../../utils/backends/Chats/chatsFirestore'
import { updateGoalProject } from '../../../../utils/backends/Goals/goalsFirestore'
import store from '../../../../redux/store'

export default function SelectProjectModal({
    item,
    project,
    closePopover,
    headerText,
    subheaderText,
    onProjectClick,
    onSelectProject,
}) {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const [width, height] = useWindowSize()
    const [offsets, setOffsets] = useState({ top: 0, bottom: 0 })
    const [scrollHeight, setScrollHeight] = useState(0)
    const [activeOptionIndex, setActiveOptionIndex] = useState(0)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const dispatch = useDispatch()
    const { projectIds } = loggedUser
    const [projectsByType, setProjectsByType] = useState({ active: [], archived: [] })
    const [currentProjectList, setCurrentProjectList] = useState(projectsByType.active)
    const [activeTab, setActiveTab] = useState(PROJECT_MODAL_ACTIVE_TAB)
    const scrollRef = useRef()
    const itemsRef = useRef([])

    const header = headerText || `${translate('Move')} ${translate(item.type)}`
    const subheader =
        subheaderText || translate('Select the project this itemType will move to', { itemType: translate(item.type) })

    const filterProjects = callback => {
        const activeProjects = ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, PROJECT_TYPE_ACTIVE)
        const archivedProjects = ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, PROJECT_TYPE_ARCHIVED)
        const sortedActiveProjects = ProjectHelper.sortProjects(activeProjects, loggedUser.uid)
        const sortedArchivedProjects = ProjectHelper.sortProjects(archivedProjects, loggedUser.uid)

        setProjectsByType({
            active: sortedActiveProjects,
            archived: sortedArchivedProjects,
        })
        setCurrentProjectList(sortedActiveProjects)
        if (callback) {
            callback({
                active: sortedActiveProjects,
                archived: sortedArchivedProjects,
            })
        }
    }

    const updateList = tab => {
        if (tab === PROJECT_MODAL_ACTIVE_TAB) {
            setCurrentProjectList(projectsByType.active)
            setActiveOptionIndex(0)
        } else if (tab === PROJECT_MODAL_ARCHIVED_TAB) {
            setCurrentProjectList(projectsByType.archived)
            setActiveOptionIndex(0)
        }
    }

    useEffect(() => {
        dispatch(blockBackgroundTabShortcut())
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            dispatch(unblockBackgroundTabShortcut())
        }
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        filterProjects(({ active, archived }) => {
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, project.id)
            let index = 0
            if (projectType === PROJECT_TYPE_ACTIVE) {
                index = findIndex(active, ['id', project.id])
                setActiveTab(PROJECT_MODAL_ACTIVE_TAB)
                setCurrentProjectList(active)
            } else if (projectType === PROJECT_TYPE_ARCHIVED) {
                index = findIndex(active, ['id', project.id])
                setActiveTab(PROJECT_MODAL_ARCHIVED_TAB)
                setCurrentProjectList(archived)
            }
            setActiveOptionIndex(index >= 0 ? index : 0)
        })
    }, [project, loggedUserProjects])

    const onCLickProject = async (e, project, newProject) => {
        if (e != null) {
            e.preventDefault()
            e.stopPropagation()
        }

        if (onSelectProject) onSelectProject()

        if (onProjectClick) {
            onProjectClick(newProject)
        } else {
            const callback = () => {
                dispatch(stopLoadingData())
            }

            const { type, data } = item

            await moveChatOnMoveObjectFromProject(project.id, newProject.id, type + 's', data.id).then(callback)

            if (type === 'task') {
                const task = data
                const taskOwner = TasksHelper.getTaskOwner(task.userId, project.id)
                dispatch(startLoadingData())

                if (!newProject.userIds.includes(taskOwner.uid) && task.userId !== DEFAULT_WORKSTREAM_ID) {
                    setTaskAssignee(project.id, task.id, loggedUser.uid, taskOwner, loggedUser, task).then(
                        updatedTask => {
                            setTaskProject(project, newProject, updatedTask, taskOwner, loggedUser)
                            dispatch([setAssignee(loggedUser), hideProjectPicker()])
                        }
                    )
                } else {
                    setTaskProject(project, newProject, task)
                    dispatch(hideProjectPicker())
                }
                setActiveOptionIndex(activeOptionIndex)
            } else if (type === 'note') {
                const note = data
                const noteOwner = TasksHelper.getUserInProject(project.id, note.userId)

                dispatch(startLoadingData())
                if (!newProject.userIds.includes(noteOwner?.uid)) {
                    note.userId = loggedUser.uid
                    setNoteProject(project, newProject, note, noteOwner, loggedUser).then(() => {
                        dispatch(stopLoadingData())
                    })
                } else {
                    setNoteProject(project, newProject, note).then(() => {
                        dispatch(stopLoadingData())
                    })
                }
                dispatch(hideProjectPicker())
                setActiveOptionIndex(activeOptionIndex)
            } else if (type === 'goal') {
                const goal = data
                updateGoalProject(project, newProject, goal)
            } else if (type === 'skill') {
                const skill = data
                const { loggedUser, route } = store.getState()
                Backend.updateSkillProject(project, newProject, skill, () => {
                    if (route === 'SkillDetailedView') {
                        NavigationService.navigate('SkillDetailedView', {
                            skillId: skill.id,
                            projectId: newProject.id,
                            skill,
                        })
                        const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
                        store.dispatch([
                            setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
                            switchProject(newProject.index),
                            setSelectedTypeOfProject(projectType),
                            setSelectedNavItem(DV_TAB_SKILL_PROPERTIES),
                        ])
                    }
                })
            }

            writeBrowserUrl(newProject)
            dismissAllPopups()
            closePopover(newProject)
        }
    }

    const writeBrowserUrl = newProject => {
        if (item.type === 'task') {
            const task = item.data
            if (selectedTab === DV_TAB_TASK_PROPERTIES) {
                const data = { noHistory: true, projectId: newProject.id, task: task.id }
                URLsTasks.push(URL_TASK_DETAILS_PROPERTIES, data, newProject.id, task.id)
            }
        } else {
            const note = item.data
        }
    }

    const selectDown = () => {
        scrollToFocusItem(activeOptionIndex)
        if (activeOptionIndex + 1 === currentProjectList.length) {
            setActiveOptionIndex(0)
        } else {
            setActiveOptionIndex(activeOptionIndex + 1)
        }
    }

    const selectUp = () => {
        scrollToFocusItem(activeOptionIndex, true)
        if (activeOptionIndex === 0) {
            setActiveOptionIndex(currentProjectList.length - 1)
        } else {
            setActiveOptionIndex(activeOptionIndex - 1)
        }
    }

    const scrollToFocusItem = (key, up = false) => {
        if (up && key === 0) {
            scrollRef.current.scrollTo({ y: currentProjectList.length * 48, animated: false })
        } else if (!up && key + 1 === currentProjectList.length) {
            scrollRef.current.scrollTo({ y: 0, animated: false })
        } else {
            const space = up ? 96 : 144
            itemsRef.current[key]?.measure((fx, fy, width, height, px, py) => {
                if (up && fy - space < offsets.top) {
                    scrollRef.current.scrollTo({ y: fy - space, animated: false })
                } else if (up && fy > offsets.bottom) {
                    scrollRef.current.scrollTo({ y: fy + 48 - scrollHeight, animated: false })
                } else if (!up && fy + space > offsets.bottom) {
                    scrollRef.current.scrollTo({ y: fy + space - scrollHeight, animated: false })
                } else if (!up && fy + 48 < offsets.top) {
                    scrollRef.current.scrollTo({ y: fy + 48, animated: false })
                }
            })
        }
    }

    const onLayoutScroll = data => {
        scrollRef.current.scrollTo({ y: 0, animated: false })
        setOffsets({ top: 0, bottom: data.nativeEvent.layout.height })
        setScrollHeight(data.nativeEvent.layout.height)
    }

    const onPressEnter = e => {
        onCLickProject(e, project, currentProjectList[activeOptionIndex])
    }

    const onKeyDown = ({ key }) => {
        if (key === 'Tab' || key === 'ArrowRight') {
            if (activeTab === PROJECT_MODAL_ACTIVE_TAB) {
                changeTab(PROJECT_MODAL_ARCHIVED_TAB)
            } else {
                changeTab(PROJECT_MODAL_ACTIVE_TAB)
            }
        } else if (key === 'ArrowLeft') {
            if (activeTab === PROJECT_MODAL_ACTIVE_TAB) {
                changeTab(PROJECT_MODAL_ARCHIVED_TAB)
            } else {
                changeTab(PROJECT_MODAL_ACTIVE_TAB)
            }
        }
    }

    const onKeyPress = (s, e, handler) => {
        switch (handler.key) {
            case 'up': {
                selectUp()
                break
            }
            case 'down': {
                selectDown()
                break
            }
            case 'enter': {
                onPressEnter(e)
                break
            }
            case 'esc': {
                e.preventDefault()
                e.stopPropagation()
                closePopover()
                break
            }
        }
    }

    const changeTab = tab => {
        if (activeTab !== tab) {
            setActiveTab(tab)
            updateList(tab)
        }
    }

    const containerWidthStyle = useMemo(() => {
        const availableWidth = typeof width === 'number' ? width - 32 : undefined
        if (!availableWidth || availableWidth >= 305) {
            return applyPopoverWidth()
        }
        const resolvedWidth = availableWidth > 0 ? availableWidth : 305
        return { width: resolvedWidth, maxWidth: resolvedWidth, minWidth: resolvedWidth }
    }, [width])

    return (
        <View style={[localStyles.container, containerWidthStyle, { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <View style={localStyles.heading}>
                <Hotkeys keyName={'up,down,enter,esc'} onKeyDown={onKeyPress} filter={e => true}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: 'white' }]}>{header}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>{subheader}</Text>
                    </View>
                </Hotkeys>

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeSubContainer} onPress={closePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>

                <View style={{ marginTop: 20 }}>
                    <Header activeTab={activeTab} changeTab={changeTab} hideGuideTab={true} />
                </View>
            </View>

            <View style={localStyles.projectListContainer}>
                <CustomScrollView
                    ref={scrollRef}
                    showsVerticalScrollIndicator={false}
                    indicatorStyle={{ right: -6 }}
                    scrollOnLayout={onLayoutScroll}
                    onScroll={({ nativeEvent }) => {
                        const y = nativeEvent.contentOffset.y
                        setOffsets({ top: y, bottom: y + scrollHeight })
                    }}
                >
                    {currentProjectList.length > 0 ? (
                        currentProjectList.map((projectItem, index) => {
                            return (
                                projectIds.includes(projectItem.id) && (
                                    <View ref={ref => (itemsRef.current[index] = ref)} key={projectItem.id}>
                                        <ProjectModalItem
                                            key={projectItem.id}
                                            project={project}
                                            newProject={projectItem}
                                            active={index === activeOptionIndex}
                                            onProjectSelect={onCLickProject}
                                        />
                                    </View>
                                )
                            )
                        })
                    ) : (
                        <EmptyResults
                            text={translate('There are not projects to show here')}
                            style={localStyles.empty}
                        />
                    )}
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        maxHeight: 356,
    },
    projectListContainer: {
        flex: 1,
        flexDirection: 'column',
        paddingHorizontal: 8,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
    },
    closeContainer: {
        position: 'absolute',
        top: 0,
        right: 8,
    },
    heading: {
        paddingHorizontal: 16,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
    empty: {
        marginBottom: 32,
    },
})
