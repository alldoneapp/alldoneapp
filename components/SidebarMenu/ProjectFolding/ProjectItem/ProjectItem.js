import React, { useEffect, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
    hideGlobalSearchPopup,
    setGlobalSearchResults,
    setSearchText,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    switchProject,
    switchShortcutProject,
    updateFeedActiveTab,
    storeLoggedUser,
} from '../../../../redux/actions'
import { updateShowAllProjectsByTime } from '../../../../utils/backends/Users/usersFirestore'
import styles from '../../../styles/global'
import NavigationService from '../../../../utils/NavigationService'
import { FOLLOWED_TAB } from '../../../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_TASKS, ROOT_ROUTES } from '../../../../utils/TabNavigationConstants'
import { exitsOpenModals } from '../../../ModalsManager/modalsManager'
import ProjectSectionList from '../ProjectSectionList'
import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import ProjectItemIcon from './ProjectItemIcon'
import ProjectItemName from './ProjectItemName'
import ProjectRightArea from './ProjectRightArea'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../../hooks/UseOnHover'
import store from '../../../../redux/store'
import { checkIfUserIsGuideAdmin } from '../../../Guides/guidesHelper'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ItemShortcut from '../../Items/Common/ItemShortcut'

export default function ProjectItem({ itemIndex, projectData, projectType, isShared, shortcutIndex, navigation }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const shortcutSelectedProjectIndex = useSelector(state => state.shortcutSelectedProjectIndex)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const shownFloatPopup = useSelector(state => state.shownFloatPopup)

    const { expanded } = useCollapsibleSidebar()
    const [highlighted, setHighlighted] = useState(false)

    const {
        id: projectId,
        name: projectName,
        color: projectColor,
        index: projectIndex,
        parentTemplateId,
        isTemplate,
    } = projectData

    const isGuide = !!parentTemplateId

    const highlight = projectIndex === selectedProjectIndex
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem')

    const showShortcut =
        !isShared && shortcutIndex <= 9 && !highlight && showShortcuts && !shownFloatPopup && !exitsOpenModals()

    useEffect(() => {
        if (
            shortcutSelectedProjectIndex?.toString() != null &&
            projectIndex.toString() != null &&
            shortcutSelectedProjectIndex?.toString() === projectIndex.toString()
        ) {
            onPress()
        }

        if (highlight && !highlighted) {
            setHighlighted(true)
        } else if (!highlight && highlighted) {
            setHighlighted(false)
        }
    }, [projectId])

    const activeGuide = async () => {
        const { loggedUser } = store.getState()
        window.location = `/projects/${projectId}/user/${loggedUser.uid}/tasks/open`
    }

    const activeTemplate = async () => {
        const { loggedUser } = store.getState()
        window.location = `/projects/${projectId}/user/${loggedUser.uid}/tasks/open`
    }

    const onPress = e => {
        const { loggedUser, activeGuideId, activeTemplateId, route } = store.getState()
        const { uid: loggedUserId } = loggedUser

        if (isGuide && checkIfUserIsGuideAdmin(loggedUser) && activeGuideId !== projectId) {
            dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
            updateShowAllProjectsByTime(loggedUserId, false)
            activeGuide()
        } else if (isTemplate && activeTemplateId !== projectId) {
            dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
            updateShowAllProjectsByTime(loggedUserId, false)
            activeTemplate()
        } else {
            e?.preventDefault()

            dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
            updateShowAllProjectsByTime(loggedUserId, false)

            let dispatches = [
                switchProject(projectIndex),
                updateFeedActiveTab(FOLLOWED_TAB),
                storeCurrentUser(loggedUser),
                setSelectedTypeOfProject(projectType),
                switchShortcutProject(null),
            ]

            if (projectIndex !== selectedProjectIndex || loggedUser.uid !== currentUserId) {
                dispatches = dispatches.concat([
                    setSearchText(''),
                    hideGlobalSearchPopup(),
                    setGlobalSearchResults(null),
                ])
            }

            dispatches = [
                ...dispatches,
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                setTaskViewToggleIndex(0),
                setTaskViewToggleSection('Open'),
            ]

            if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')
            dispatch(dispatches)
        }
    }

    return (
        <View
            accessibilityLabel={`sidebar-project-${shortcutIndex}`}
            nativeID={`sidebar-project-${projectId}-${itemIndex}`}
        >
            {showShortcut && <ItemShortcut shortcut={shortcutIndex} />}

            <TouchableOpacity onPress={onPress} disabled={isShared}>
                <View
                    style={[
                        ...(highlight
                            ? [localStyles.container, theme.containerActive(projectColor)]
                            : [localStyles.container, theme.container(projectColor)]),
                        !highlight && hover && theme.containerActive(projectColor),
                        !expanded && localStyles.containerCollapsed,
                    ]}
                    onMouseEnter={onHover}
                    onMouseLeave={offHover}
                >
                    <View style={localStyles.headerContainer}>
                        <ProjectItemIcon
                            projectId={projectId}
                            projectColor={projectColor}
                            highlight={highlight}
                            isGuide={isGuide}
                        />
                        {expanded && <ProjectItemName projectName={projectName} highlight={highlight} />}
                    </View>

                    {expanded && !isShared && (
                        <ProjectRightArea projectIndex={projectIndex} projectId={projectId} highlight={highlight} />
                    )}
                </View>
            </TouchableOpacity>

            {highlight && checkIfSelectedProject(selectedProjectIndex) && (
                <ProjectSectionList
                    navigation={navigation}
                    projectData={projectData}
                    projectType={projectType}
                    isShared={isShared}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        paddingLeft: 24,
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    headerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    indicatorText: {
        ...styles.indicatorText,
    },
})
