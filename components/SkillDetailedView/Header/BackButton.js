import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import Icon from '../../Icon'
import { SIDEBAR_MENU_COLLAPSED_WIDTH, colors } from '../../styles/global'
import NavigationService from '../../../utils/NavigationService'
import { hideFloatPopup, setSelectedSidebarTab } from '../../../redux/actions'
import { MIN_URLS_IN_HISTORY } from '../../../URLSystem/URLTrigger'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import { getDvLink } from '../../../utils/LinkingHelper'
import SharedHelper from '../../../utils/SharedHelper'

export default function BackButton({ projectId }) {
    const dispatch = useDispatch()
    const lastVisitedScreen = useSelector(state => state.lastVisitedScreen)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const skillId = useSelector(state => state.skillInDv.id)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)

    const onPress = () => {
        const commonPath = getDvLink(projectId, skillId, 'skills')

        dispatch(hideFloatPopup())
        if (lastVisitedScreen.length >= MIN_URLS_IN_HISTORY) {
            SharedHelper.onHistoryPop(commonPath)
        } else {
            NavigationService.navigate('Root')
            dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
        }
    }

    return (
        <TouchableOpacity
            style={[
                localStyles.container,
                isMiddleScreen ? localStyles.mobileContainer : localStyles.desktopContainer,
                !isMiddleScreen && !sidebarExpanded && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
            ]}
            onPress={onPress}
        >
            <Icon name="arrow-left" size={24} color={colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 32,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: 57,
        height: 32,
        backgroundColor: 'white',
        borderRightWidth: 1,
        borderRightColor: colors.Gray300,
    },
    mobileContainer: {
        left: -16,
    },
    desktopContainer: {
        position: 'absolute',
        top: 0,
        left: 32,
        zIndex: 100,
    },
})
