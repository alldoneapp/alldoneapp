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
import {
    getAssistantTemplateReviewCount,
    getAssistantTemplateReviewLabelKey,
} from '../../AssistantDetailedView/Customizations/UpdateFromTemplate/templateReview'
import { translate } from '../../../i18n/TranslationService'

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
    // `assistant` is the redux object (state.projectAssistants[projectId]), so the
    // count re-renders when the sync trigger writes conflicts.
    const templateReviewCount = getAssistantTemplateReviewCount(assistant)
    const templateReviewLabel = templateReviewCount
        ? `${templateReviewCount} ${translate(getAssistantTemplateReviewLabelKey(templateReviewCount))}`
        : ''

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
                {/*
                 * Expanded: the review marker takes over the decorative cpu icon's
                 * slot — a pending review is strictly more informative than the type
                 * icon, and the 48px row has room for only one.
                 * Collapsed: the sidebar is SIDEBAR_MENU_COLLAPSED_WIDTH (56px), so
                 * 18px padding + a 20px avatar + a 20px icon would overflow; the
                 * absolute dot is the same trick Indicator.js uses for that width.
                 * Either way the review is visible without opening the assistant,
                 * which is the whole point (AT-2358).
                 */}
                {templateReviewCount > 0 ? (
                    expanded ? (
                        <Icon
                            style={{ marginRight: 24 }}
                            name={'alert-circle'}
                            size={20}
                            color={colors.UtilityYellow300}
                            accessibilityLabel={templateReviewLabel}
                        />
                    ) : (
                        <View style={localStyles.reviewDot} accessibilityLabel={templateReviewLabel} />
                    )
                ) : (
                    expanded && <Icon style={{ marginRight: 24 }} name={'cpu'} size={20} color={colors.Text03} />
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
    // Clears the 20px avatar that starts at the container's 18px left padding, and
    // stays inside the 56px collapsed sidebar.
    reviewDot: {
        position: 'absolute',
        top: 12,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.UtilityYellow300,
    },
})
