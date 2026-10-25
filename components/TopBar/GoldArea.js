import React, { useEffect, useReducer, useRef } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { navigateToSettings } from '../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../utils/TabNavigationConstants'
import NavigationService from '../../utils/NavigationService'
import { parseNumberToUseThousand } from '../StatisticsView/statisticsHelper'
import Gold from '../../assets/svg/Gold'
import {
    getDisplayedGold,
    subscribeToCoinLandings,
    subscribeToGoldCounter,
} from '../RootView/GoldCoins/goldCounterBridge'

export default function GoldArea({ containerStyle }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const smallScreen = useSelector(state => state.smallScreen)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const gold = useSelector(state => state.loggedUser.gold)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const showGoldChain = useSelector(state => state.showGoldChain)
    // While earned coins fly in, the counter counts them up one by one (see goldCounterBridge) and
    // the icon gives a little bump as each lands.
    const [, refresh] = useReducer(count => count + 1, 0)
    const bump = useRef(new Animated.Value(0)).current
    useEffect(() => subscribeToGoldCounter(refresh), [])
    useEffect(
        () =>
            subscribeToCoinLandings(() => {
                bump.setValue(1)
                Animated.spring(bump, { toValue: 0, friction: 4, tension: 160, useNativeDriver: false }).start()
            }),
        []
    )
    const displayedGold = getDisplayedGold(gold)

    const navigateToUserProfile = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
        NavigationService.navigate('SettingsView')
    }

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.GoldArea')

    // Anonymous viewers of shared notes/chats have no gold of their own and must not see the
    // resource owner's balance, so hide the gold pill entirely for them.
    if (isAnonymous) return null

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
            <Animated.View
                nativeID="goldArea"
                style={{
                    opacity: showGoldChain ? 0 : 1,
                    padding: 1.286,
                    transform: [{ scale: bump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] }) }],
                }}
            >
                <Gold width={21.43} height={21.43} id="goldArea" />
            </Animated.View>
            <Text style={[localStyle.text, theme.text]}>{parseNumberToUseThousand(displayedGold)}</Text>
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
