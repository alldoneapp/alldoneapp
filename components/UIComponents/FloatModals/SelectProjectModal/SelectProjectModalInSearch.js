import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { findIndex } from 'lodash'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors, SIDEBAR_MENU_WIDTH } from '../../../styles/global'
import Icon from '../../../Icon'
import ProjectModalItem from './ProjectModalItem'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { blockBackgroundTabShortcut, unblockBackgroundTabShortcut } from '../../../../redux/actions'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_ARCHIVED,
    PROJECT_TYPE_GUIDE,
    PROJECT_TYPE_SHARED,
    PROJECT_TYPE_TEMPLATE,
} from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import AllProjectItem from './AllProjectItem'
import EmptyResults from '../EmptyResults'
import { translate } from '../../../../i18n/TranslationService'
import HeaderInSearch from './HeaderInSearch'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export const ALL_PROJECTS_OPTION = 'ALL_PROJECTS'

export default function SelectProjectModalInSearch({
    projectId,
    closePopover,
    projects,
    setSelectedProjectId,
    headerText,
    subheaderText,
    positionInPlace,
    showGuideTab,
    showTemplateTab,
    showArchivedTab,
    showAllProjects,
}) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [offsets, setOffsets] = useState({ top: 0, bottom: 0 })
    const [scrollHeight, setScrollHeight] = useState(0)
    const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
    const [projectsByType, setProjectsByType] = useState({
        [PROJECT_TYPE_ACTIVE]: [],
        [PROJECT_TYPE_ARCHIVED]: [],
        [PROJECT_TYPE_GUIDE]: [],
        [PROJECT_TYPE_TEMPLATE]: [],
    })
    const [currentProjectList, setCurrentProjectList] = useState([])
    const [activeTabIndex, setActiveTabIndex] = useState(0)
    const [width, height] = useWindowSize()
    const scrollRef = useRef()
    const itemsRef = useRef([])

    const header = headerText || translate('Select search scope')
    const subheader = subheaderText || translate('Select an option to define the search scope')

    const visibleTabs = [{ type: PROJECT_TYPE_ACTIVE, name: 'Active' }]
    if (showGuideTab) visibleTabs.push({ type: PROJECT_TYPE_GUIDE, name: 'Community' })
    if (showTemplateTab) visibleTabs.push({ type: PROJECT_TYPE_TEMPLATE, name: 'Template' })
    if (showArchivedTab) visibleTabs.push({ type: PROJECT_TYPE_ARCHIVED, name: 'Archived' })

    const extractActiveProjects = () => {
        const { realGuideProjectIds, realTemplateProjectIds, realArchivedProjectIds } = loggedUser
        return projects.filter(
            project =>
                !realGuideProjectIds.includes(project.id) &&
                !realTemplateProjectIds.includes(project.id) &&
                !realArchivedProjectIds.includes(project.id)
        )
    }

    const extractGuideProjects = () => {
        const { realGuideProjectIds } = loggedUser
        return projects.filter(project => realGuideProjectIds.includes(project.id))
    }

    const extractTemplateProjects = () => {
        const { realTemplateProjectIds } = loggedUser
        return projects.filter(project => realTemplateProjectIds.includes(project.id))
    }

    const extractArchivedProjects = () => {
        const { realArchivedProjectIds } = loggedUser
        return projects.filter(project => realArchivedProjectIds.includes(project.id))
    }

    const getProjectType = projectId => {
        const { projectIds, realGuideProjectIds, realTemplateProjectIds, realArchivedProjectIds } = loggedUser

        if (realGuideProjectIds.includes(projectId)) {
            return PROJECT_TYPE_GUIDE
        } else if (realTemplateProjectIds.includes(projectId)) {
            return PROJECT_TYPE_TEMPLATE
        } else if (realArchivedProjectIds.includes(projectId)) {
            return PROJECT_TYPE_ARCHIVED
        } else if (projectIds.includes(projectId)) {
            return PROJECT_TYPE_ACTIVE
        } else {
            return PROJECT_TYPE_SHARED
        }
    }

    const filterProjects = () => {
        const activeProjects = extractActiveProjects()
        const archivedProjects = extractArchivedProjects()
        const guideProjects = extractGuideProjects()
        const templateProjects = extractTemplateProjects()

        const sortedActiveProjects = ProjectHelper.sortProjects(activeProjects, loggedUser.uid)
        const sortedGuideProjects = ProjectHelper.sortProjects(guideProjects, loggedUser.uid)
        const sortedTemplateProjects = ProjectHelper.sortProjects(templateProjects, loggedUser.uid)
        const sortedArchivedProjects = ProjectHelper.sortProjects(archivedProjects, loggedUser.uid)

        setProjectsByType({
            [PROJECT_TYPE_ACTIVE]: sortedActiveProjects,
            [PROJECT_TYPE_ARCHIVED]: sortedArchivedProjects,
            [PROJECT_TYPE_GUIDE]: sortedGuideProjects,
            [PROJECT_TYPE_TEMPLATE]: sortedTemplateProjects,
        })
        setCurrentProjectList(sortedActiveProjects)

        const projectType = getProjectType(projectId)
        let index = -1
        if (projectType === PROJECT_TYPE_ACTIVE) {
            index = findIndex(sortedActiveProjects, ['id', projectId])
            const tabIndex = visibleTabs.findIndex(tab => tab.type === projectType)
            setActiveTabIndex(tabIndex)
            setCurrentProjectList(sortedActiveProjects)
        } else if (projectType === PROJECT_TYPE_GUIDE) {
            index = findIndex(sortedGuideProjects, ['id', projectId])
            const tabIndex = visibleTabs.findIndex(tab => tab.type === projectType)
            setActiveTabIndex(tabIndex)
            setCurrentProjectList(sortedGuideProjects)
        } else if (projectType === PROJECT_TYPE_ARCHIVED) {
            index = findIndex(sortedArchivedProjects, ['id', projectId])
            const tabIndex = visibleTabs.findIndex(tab => tab.type === projectType)
            setActiveTabIndex(tabIndex)
            setCurrentProjectList(sortedArchivedProjects)
        } else if (projectType === PROJECT_TYPE_TEMPLATE) {
            index = findIndex(sortedTemplateProjects, ['id', projectId])
            const tabIndex = visibleTabs.findIndex(tab => tab.type === projectType)
            setActiveTabIndex(tabIndex)
            setCurrentProjectList(sortedTemplateProjects)
        }

        setActiveOptionIndex(index >= 0 ? index : -1)
    }

    useEffect(() => {
        scrollRef?.current?.scrollTo({ y: 0, animated: false })
    }, [activeTabIndex])

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
        filterProjects()
    }, [projectId, projects])

    const selectDown = () => {
        scrollToFocusItem(activeOptionIndex)
        if (activeOptionIndex + 1 === currentProjectList.length) {
            setActiveOptionIndex(showAllProjects ? -1 : 0)
        } else {
            setActiveOptionIndex(activeOptionIndex + 1)
        }
    }

    const selectUp = () => {
        scrollToFocusItem(activeOptionIndex, true)
        if (activeOptionIndex === (showAllProjects ? -1 : 0)) {
            setActiveOptionIndex(currentProjectList.length - 1)
        } else {
            setActiveOptionIndex(activeOptionIndex - 1)
        }
    }

    const scrollToFocusItem = (key, up = false) => {
        if (up && key === -1) {
            scrollRef?.current?.scrollTo({ y: currentProjectList.length * 48, animated: false })
        } else if (!up && key + 1 === currentProjectList.length) {
            scrollRef?.current?.scrollTo({ y: 0, animated: false })
        } else {
            const space = up ? 96 : 144
            itemsRef.current[key]?.measure((fx, fy) => {
                if (up && fy - space < offsets.top) {
                    scrollRef?.current?.scrollTo({ y: fy - space, animated: false })
                } else if (up && fy > offsets.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + 48 - scrollHeight, animated: false })
                } else if (!up && fy + space > offsets.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + space - scrollHeight, animated: false })
                } else if (!up && fy + 48 < offsets.top) {
                    scrollRef?.current?.scrollTo({ y: fy + 48, animated: false })
                }
            })
        }
    }

    const onLayoutScroll = data => {
        scrollRef?.current?.scrollTo({ y: 0, animated: false })
        setOffsets({ top: 0, bottom: data.nativeEvent.layout.height })
        setScrollHeight(data.nativeEvent.layout.height)
    }

    const onPressEnter = () => {
        if (activeOptionIndex === -1) {
            selectOption(ALL_PROJECTS_OPTION)
        } else {
            selectOption(currentProjectList[activeOptionIndex].id)
        }
    }

    const selectOption = projectId => {
        setSelectedProjectId(projectId)
        closePopover()
    }

    const onKeyDown = ({ key }) => {
        if (key === 'Tab' || key === 'ArrowRight') {
            if (visibleTabs.length === activeTabIndex + 1) {
                changeTab(0)
            } else {
                changeTab(activeTabIndex + 1)
            }
        } else if (key === 'ArrowLeft') {
            if (activeTabIndex === 0) {
                changeTab(visibleTabs.length - 1)
            } else {
                changeTab(activeTabIndex - 1)
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

    const changeTab = tabIndex => {
        if (activeTabIndex !== tabIndex) {
            setActiveTabIndex(tabIndex)
            setCurrentProjectList(projectsByType[visibleTabs[tabIndex].type])
            setActiveOptionIndex(-1)
        }
    }

    let sidebarOpenStyle = smallScreenNavigation || positionInPlace ? null : { marginLeft: SIDEBAR_MENU_WIDTH }

    return (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                { maxHeight: height - MODAL_MAX_HEIGHT_GAP },
                sidebarOpenStyle,
            ]}
        >
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
                    <HeaderInSearch activeTabIndex={activeTabIndex} changeTab={changeTab} tabs={visibleTabs} />
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
                    {showAllProjects && visibleTabs[activeTabIndex].type === PROJECT_TYPE_ACTIVE && (
                        <AllProjectItem
                            selectedProjectId={projectId}
                            onProjectSelect={(e, p, newProject) => {
                                selectOption(newProject.id)
                            }}
                            active={activeOptionIndex === -1}
                        />
                    )}

                    {currentProjectList.length > 0 ? (
                        currentProjectList.map((projectItem, index) => {
                            return (
                                <View ref={ref => (itemsRef.current[index] = ref)} key={projectItem.id}>
                                    <ProjectModalItem
                                        key={projectItem.id}
                                        selectedProjectId={projectId}
                                        newProject={projectItem}
                                        active={index === activeOptionIndex}
                                        onProjectSelect={(e, p, newProject) => {
                                            selectOption(newProject.id)
                                        }}
                                    />
                                </View>
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
        zIndex: 11000,
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
