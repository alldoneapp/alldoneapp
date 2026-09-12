import React from 'react'
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

export default function RootView({ navigation }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    useTranslator()

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
        backgroundColor: 'white',
    },
    subContainer: {
        flex: 1,
    },
    topBarContainer: {
        zIndex: 10,
    },
})
