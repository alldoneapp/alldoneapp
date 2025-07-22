import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { navigateToSettings } from '../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../utils/TabNavigationConstants'
import NavigationService from '../../utils/NavigationService'
import { parseNumberToUseThousand } from '../StatisticsView/statisticsHelper'
import Gold from '../../assets/svg/Gold'

export default function GoldArea({ containerStyle }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const smallScreen = useSelector(state => state.smallScreen)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const gold = useSelector(state => state.loggedUser.gold)
    const showGoldChain = useSelector(state => state.showGoldChain)

    const navigateToUserProfile = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
        NavigationService.navigate('SettingsView')
    }

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.GoldArea')

    return (
        <TouchableOpacity
            style={[
                localStyle.container,
                (smallScreenNavigation || smallScreen) && {
                    marginRight: 8,
                },
                smallScreenNavigation ? theme.containerMobile : theme.container,
                ,
                containerStyle,
            ]}
            onPress={navigateToUserProfile}
        >
            <View nativeID="goldArea" style={{ opacity: showGoldChain ? 0 : 1, padding: 1.286 }}>
                <Gold width={21.43} height={21.43} id="goldArea" />
            </View>
            <Text style={[localStyle.text, theme.text]}>{parseNumberToUseThousand(gold)}</Text>
        </TouchableOpacity>
    )
}

const localStyle = StyleSheet.create({
    container: {
        padding: 2,
        paddingRight: 12,
        flexDirection: 'row',
        borderRadius: 16,
        alignItems: 'center',
        marginRight: 16,
        height: 28,
    },
    text: {
        ...styles.caption2,
        marginLeft: 8,
    },
})
