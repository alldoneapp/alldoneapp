import React, { useRef, useEffect } from 'react'
import { Animated, ScrollView, StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import TopBarMobileStatisticArea from './TopBarMobileStatisticArea'
import MobileNotificationArea from './MobileNotificationArea'
import { toggleNavPicker } from '../../../redux/actions'
import QuotaBar, { QUOTA_BAR_MOBILE } from '../QuotaBar/QuotaBar'
import PremiumBar from '../PremiumBar/PremiumBar'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import TasksStatisticsArea from '../TasksStatisticsArea'
import { PLAN_STATUS_PREMIUM } from '../../Premium/PremiumHelper'
import XpBar, { XP_BAR_MOBILE, barWidth } from '../../XpBar/XpBar'
import HomeButton, { HOME_BUTTON_WIDTH } from '../HomeButton'
import GoldArea from '../GoldArea'

const SECONDARY_BAR_MOBILE = 36

export default function TopBarMobile({ compact: compactOverride, showMenu = true }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const expandedNavPicker = useSelector(state => state.expandedNavPicker)
    const reallySmallScreenNavigation = useSelector(state => state.reallySmallScreenNavigation)
    const compact = compactOverride ?? reallySmallScreenNavigation
    const height = useRef(new Animated.Value(0)).current

    const theme = getTheme(Themes, themeName, 'TopBarMobile')

    const expandSecondaryBar = () => {
        dispatch(toggleNavPicker(!expandedNavPicker))
    }

    useEffect(() => {
        if (expandedNavPicker) dispatch(toggleNavPicker(false))
    }, [])
    useEffect(() => {
        const animation = Animated.timing(height, {
            toValue: expandedNavPicker ? SECONDARY_BAR_MOBILE : 0,
            duration: 200,
            // Height is a layout prop, so the native driver cannot drive it.
            useNativeDriver: false,
        })
        animation.start()
        return () => animation.stop()
    }, [expandedNavPicker, height])

    const statistics = (
        <>
            <TasksStatisticsArea />
            {premiumStatus === PLAN_STATUS_PREMIUM ? (
                <PremiumBar size={QUOTA_BAR_MOBILE} />
            ) : (
                <QuotaBar size={QUOTA_BAR_MOBILE} />
            )}
        </>
    )

    return (
        <View>
            <View testID="top-bar-mobile" style={[localStyles.container, theme.container]}>
                <View style={localStyles.statisticArea}>
                    <TopBarMobileStatisticArea
                        expandSecondaryBar={expandSecondaryBar}
                        compact={compact}
                        showMenu={showMenu}
                    />
                </View>
                <View style={localStyles.notificationArea}>
                    {!isAnonymous && (
                        <MobileNotificationArea expandSecondaryBar={expandSecondaryBar} compact={compact} />
                    )}
                </View>
                <HomeButton
                    color={theme.homeIcon}
                    style={localStyles.homeButton}
                    expandSecondaryBar={expandSecondaryBar}
                />
            </View>

            {!isAnonymous && (
                <Animated.View
                    testID="top-bar-mobile-statistics"
                    style={[localStyles.itemsContainerMobile, theme.itemsContainerMobile, { height: height }]}
                >
                    {expandedNavPicker &&
                        (compact ? (
                            <ScrollView
                                horizontal
                                style={localStyles.compactStatistics}
                                contentContainerStyle={localStyles.statisticsRow}
                            >
                                <View style={localStyles.xpContainer}>
                                    <XpBar size={XP_BAR_MOBILE} />
                                </View>
                                <GoldArea />
                                {statistics}
                            </ScrollView>
                        ) : (
                            <>
                                <XpBar size={XP_BAR_MOBILE} />
                                {statistics}
                            </>
                        ))}
                </Animated.View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        height: 56,
    },
    statisticArea: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    notificationArea: {
        flexDirection: 'row',
    },
    homeButton: {
        position: 'absolute',
        left: '50%',
        marginLeft: -HOME_BUTTON_WIDTH / 2,
        top: 14,
    },
    itemsContainerMobile: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        height: 0,
        paddingHorizontal: 16,
        marginLeft: -18,
        overflow: 'hidden',
    },
    compactStatistics: {
        flex: 1,
        minWidth: 0,
    },
    statisticsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        height: SECONDARY_BAR_MOBILE,
        flexGrow: 1,
    },
    xpContainer: {
        // XpBar normally grows into available space; reserve its mobile width in the scroll row.
        width: barWidth[XP_BAR_MOBILE] + 8,
        flexShrink: 0,
    },
})
