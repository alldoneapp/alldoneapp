import React, { useRef, useEffect, useState } from 'react'
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

const SECONDARY_BAR_MOBILE = 36
const TOP_ROW_PADDING = 16
const HOME_BUTTON_GAP = 8

// AT-3044: the left group (menu + Gold) must stop short of the absolutely centred Home button, so
// a long balance on a narrow phone shrinks instead of sliding under it.
export const getLeftAreaMaxWidth = rowWidth =>
    rowWidth > 0 ? Math.max(0, rowWidth / 2 - HOME_BUTTON_WIDTH / 2 - TOP_ROW_PADDING - HOME_BUTTON_GAP) : undefined

export default function TopBarMobile({ compact: compactOverride, showMenu = true }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const expandedNavPicker = useSelector(state => state.expandedNavPicker)
    const reallySmallScreenNavigation = useSelector(state => state.reallySmallScreenNavigation)
    const compact = compactOverride ?? reallySmallScreenNavigation
    const height = useRef(new Animated.Value(0)).current
    const [rowWidth, setRowWidth] = useState(0)
    const leftAreaMaxWidth = getLeftAreaMaxWidth(rowWidth)

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
            <View
                testID="top-bar-mobile"
                style={[localStyles.container, theme.container]}
                onLayout={({ nativeEvent }) => setRowWidth(nativeEvent.layout.width)}
            >
                <View
                    testID="top-bar-mobile-left"
                    style={[
                        localStyles.statisticArea,
                        leftAreaMaxWidth !== undefined && { maxWidth: leftAreaMaxWidth },
                    ]}
                >
                    <TopBarMobileStatisticArea expandSecondaryBar={expandSecondaryBar} showMenu={showMenu} />
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
        paddingHorizontal: TOP_ROW_PADDING,
        height: 56,
    },
    statisticArea: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
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
