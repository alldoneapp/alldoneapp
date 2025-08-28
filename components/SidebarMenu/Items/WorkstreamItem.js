import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import {
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setGoalsActiveTab,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
} from '../../../redux/actions'
import { GOALS_OPEN_TAB_INDEX } from '../../GoalsView/GoalsHelper'
import NavigationService from '../../../utils/NavigationService'
import { setWorkstreamLastVisitedBoardDate } from '../../Workstreams/WorkstreamHelper'
import { DV_TAB_ROOT_TASKS, DV_TAB_ROOT_GOALS, ROOT_ROUTES } from '../../../utils/TabNavigationConstants'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import ItemShortcut from './Common/ItemShortcut'
import Amount from './Common/Amount'
import WorkstreamData from './Common/WorkstreamData'
import Indicator from './Common/Indicator'
import ActiveMilestoneTagCapacityDot from '../../Tags/ActiveMilestoneTagCapacityDot'

export default function WorkstreamItem({
    workstream,
    projectType,
    projectId,
    projectColor,
    isShared,
    shortcut,
    navItem,
    showIndicator,
    milestone,
    goals,
}) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const shownFloatPopup = useSelector(state => state.shownFloatPopup)
    const shortcutCurrentUserUid = useSelector(state => state.shortcutCurrentUserUid)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)

    const showShortcut = shortcut != null && showShortcuts && !shownFloatPopup && !exitsOpenModals()
    const highlight = currentUserId === workstream.uid
    const showAmount = navItem === DV_TAB_ROOT_TASKS
    const showMilestoneCapacity = milestone && goals
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    useEffect(() => {
        if (shortcutCurrentUserUid === workstream.uid) onPress()
    }, [shortcutCurrentUserUid])

    const hideSideBar = () => {
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
    }

    const getLastVisitedBoardProerty = () => {
        if (navItem === DV_TAB_ROOT_GOALS) return 'lastVisitBoardInGoals'
        if (navItem === DV_TAB_ROOT_TASKS) return 'lastVisitBoard'
    }

    const onPress = e => {
        e?.preventDefault()
        const { route, selectedNavItem } = store.getState()
        if (selectedNavItem !== navItem) dispatch(setSelectedSidebarTab(navItem))

        if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')

        setWorkstreamLastVisitedBoardDate(projectId, workstream, getLastVisitedBoardProerty())

        let dispatches = [
            setSelectedSidebarTab(navItem), // Comment this to NOT go to Tasks when change workstream in sidebar
            storeCurrentUser(workstream),
            setSelectedTypeOfProject(projectType),
            storeCurrentShortcutUser(null),
        ]

        if (navItem === DV_TAB_ROOT_TASKS) {
            dispatches.push(setTaskViewToggleIndex(0))
            dispatches.push(setTaskViewToggleSection('Open'))
        } else if (navItem === DV_TAB_ROOT_GOALS) {
            dispatches.push(setGoalsActiveTab(GOALS_OPEN_TAB_INDEX))
        }

        dispatch(dispatches)
        hideSideBar()
    }

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={isShared}
            accessibilityLabel={'sidebar-user-item'}
            nativeID={`sidebar-user@${workstream.uid}`}
        >
            {/*{showShortcut && <ItemShortcut shortcut={shortcut} />}*/}
            <View
                style={[
                    localStyles.container,
                    highlight ? theme.containerActive(projectColor) : theme.container(projectColor),
                    !expanded && localStyles.containerCollapsed,
                    !highlight && hover && theme.containerActive(projectColor),
                ]}
                onMouseEnter={onHover}
                onMouseLeave={offHover}
            >
                {showIndicator && !highlight && <Indicator projectColor={projectColor} />}
                <WorkstreamData workstreamId={workstream.uid} workstreamName={workstream.displayName} />
                {showAmount && !isShared && (expanded || highlight) && (
                    <Amount userId={workstream.uid} projectColor={projectColor} projectId={projectId} />
                )}
                {expanded && !isShared && showMilestoneCapacity && (
                    <ActiveMilestoneTagCapacityDot
                        projectId={projectId}
                        milestone={milestone}
                        goals={goals}
                        externalStyle={{ marginRight: 27 }}
                    />
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'space-between',
        flexDirection: 'row',
        height: 48,
        paddingLeft: 26,
    },
    containerCollapsed: {
        paddingLeft: 18,
    },
})
