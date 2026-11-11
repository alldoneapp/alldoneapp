import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import CustomSideMenu from '../SidebarMenu/CustomSideMenu'
import { setScreenDimensions } from '../../redux/actions'
import LoadingData from '../UIComponents/LoadingData'
import TopBarContainer from '../TopBar/TopBarContainer'
import MainViewsContainer from './MainViewsContainer'
import GlobalModalsContainerRootView from '../UIComponents/GlobalModalsContainerRootView'
import DragModalsContainer from '../UIComponents/FloatModals/DragModalsContainer'
import GoldAnimationsContainer from './GoldAnimationsContainer'
import { useTranslator } from '../../i18n/TranslationService'

import { setColorModePreference, themed } from '../../Themes/colorMode'

export default function RootView({ navigation }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    useTranslator()

    // The appearance chosen in settings follows the user to every device. Until they choose,
    // the device's own preference (default: auto, i.e. the OS light/dark setting) stays.
    const userColorMode = useSelector(state => state.loggedUser.colorMode)
    useEffect(() => {
        if (userColorMode) setColorModePreference(userColorMode)
    }, [userColorMode])

    const onLayout = ({ nativeEvent }) => {
        dispatch(setScreenDimensions(nativeEvent.layout))
    }

    const showLeftSideMenu =
        (!isAnonymous && !smallScreenNavigation) || (smallScreenNavigation && showWebSideBar.visible)
    const showRightSideMenu = !smallScreenNavigation && isAnonymous

    return (
        <View style={localStyles.container} onLayout={onLayout}>
            <GlobalModalsContainerRootView />
            <LoadingData />
            {showLeftSideMenu && <CustomSideMenu navigation={navigation} />}
            <View style={localStyles.subContainer}>
                <TopBarContainer containerStyle={localStyles.topBarContainer} />
                <MainViewsContainer />
                <DragModalsContainer />
            </View>
            {showRightSideMenu && <CustomSideMenu navigation={navigation} />}
            <GoldAnimationsContainer />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: themed.Surface,
    },
    subContainer: {
        flex: 1,
    },
    topBarContainer: {
        zIndex: 10,
    },
})
