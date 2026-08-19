import React, { useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import {
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
    setSelectedNavItem,
} from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import {
    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_TASKS,
} from '../../../utils/TabNavigationConstants'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import AssistantData from './Common/AssistantData'
import { GLOBAL_PROJECT_ID } from '../../AdminPanel/Assistants/assistantsHelper'
import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { setAssistantLastVisitedBoardDate } from '../../../utils/backends/Assistants/assistantsFirestore'

export default function AssistantItem({ assistant, projectType, projectId, projectColor, isShared, navItem }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const shortcutCurrentUserUid = useSelector(state => state.shortcutCurrentUserUid)
    const route = useSelector(state => state.route)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)

    const highlight = currentUserId === assistant.uid
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    const hideSideBar = () => {
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
    }

    const onPress = e => {
        e?.preventDefault()
        const { selectedNavItem, globalAssistants } = store.getState()

        if (currentUserId === assistant.uid && (route === DV_TAB_ROOT_TASKS || route === DV_TAB_ROOT_GOALS)) {
            NavigationService.navigate('AssistantDetailedView', {
                assistantId: assistant.uid,
                assistant,
                projectId,
            })
            dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
            return
        }

        if (selectedNavItem !== navItem) dispatch(setSelectedSidebarTab(navItem))

        if (route !== navItem) NavigationService.navigate('Root')

        const isGlobalAssistant = globalAssistants.find(item => item.uid === assistant.uid)

        setAssistantLastVisitedBoardDate(
            isGlobalAssistant ? GLOBAL_PROJECT_ID : projectId,
            assistant,
            projectId,
            'lastVisitBoard'
        )

        let dispatches = [
            setSelectedSidebarTab(navItem),
            storeCurrentUser(assistant),
            setSelectedTypeOfProject(projectType),
            storeCurrentShortcutUser(null),
        ]

        if (navItem === DV_TAB_ROOT_TASKS) {
            dispatches.push(setTaskViewToggleIndex(0))
            dispatches.push(setTaskViewToggleSection('Open'))
        }

        dispatch(dispatches)
        hideSideBar()
    }

    useEffect(() => {
        if (shortcutCurrentUserUid === assistant.uid) onPress()
    }, [shortcutCurrentUserUid])

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={isShared}
            accessibilityLabel={'sidebar-user-item'}
            nativeID={`sidebar-user@${assistant.uid}`}
        >
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
                <AssistantData assistant={assistant} />
                {expanded && <Icon style={{ marginRight: 24 }} name={'cpu'} size={20} color={colors.Text03} />}
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
