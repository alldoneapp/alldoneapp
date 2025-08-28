import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, shallowEqual, useDispatch } from 'react-redux'

import Header from './Header/Header'
import BackButton from './Header/BackButton'
import CustomScrollView from '../UIControls/CustomScrollView'
import { DV_TAB_SKILL_NOTE, DV_TAB_SKILL_CHAT } from '../../utils/TabNavigationConstants'
import SharedHelper from '../../utils/SharedHelper'
import Sections from './Sections'
import NavigationBarContainer from './NavigationBarContainer'
import { setDvIsFullScreen } from '../../redux/actions'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'

export default function DvContainer({ projectId }) {
    const dispatch = useDispatch()
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const userProjectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const isFullScreen = useSelector(state => state.dvIsFullScreen)
    const assistantEnabled = useSelector(state => state.assistantEnabled)

    const userHasAccessToProject = SharedHelper.checkIfUserHasAccessToProject(
        isAnonymous,
        userProjectIds,
        projectId,
        false
    )

    const { overlay } = useCollapsibleSidebar()

    const CustomView =
        selectedNavItem === DV_TAB_SKILL_NOTE || selectedNavItem === DV_TAB_SKILL_CHAT ? View : CustomScrollView

    useEffect(() => {
        dispatch(setDvIsFullScreen(assistantEnabled))
    }, [assistantEnabled])

    return (
        <View style={{ flex: 1 }}>
            {!isMiddleScreen && userHasAccessToProject && <BackButton projectId={projectId} />}

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
                    {(!isFullScreen || selectedNavItem !== DV_TAB_SKILL_NOTE) && (
                        <Header projectId={projectId} userHasAccessToProject={userHasAccessToProject} />
                    )}
                    <View style={{ flex: 1 }}>
                        {!isFullScreen && <NavigationBarContainer userHasAccessToProject={userHasAccessToProject} />}
                        <Sections projectId={projectId} userHasAccessToProject={userHasAccessToProject} />
                    </View>
                </View>
            </CustomView>
        </View>
    )
}

const localStyles = StyleSheet.create({
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
})
