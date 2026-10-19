import React, { useRef, useEffect } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
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
import XpBar, { XP_BAR_MOBILE } from '../../XpBar/XpBar'
import AssistantModeButton from '../AssistantModeButton'
import GoldArea from '../GoldArea'

const SECONDARY_BAR_MOBILE = 36

export default function TopBarMobile() {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const expandedNavPicker = useSelector(state => state.expandedNavPicker)
    const compact = useSelector(state => state.reallySmallScreenNavigation)
    const height = useRef(new Animated.Value(0)).current
    const secondaryBarHeight = compact ? SECONDARY_BAR_MOBILE * 2 : SECONDARY_BAR_MOBILE

    const theme = getTheme(Themes, themeName, 'TopBarMobile')

    const expandSecondaryBar = () => {
        dispatch(toggleNavPicker(!expandedNavPicker))
    }

    useEffect(() => {
        if (expandedNavPicker) dispatch(toggleNavPicker(false))
    }, [])
    useEffect(() => {
        const animation = Animated.timing(height, {
            toValue: expandedNavPicker ? secondaryBarHeight : 0,
            duration: 200,
            // Height is a layout prop, so the native driver cannot drive it.
            useNativeDriver: false,
        })
        animation.start()
        return () => animation.stop()
    }, [expandedNavPicker, secondaryBarHeight, height])

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
                        homeIconColor={theme.homeIcon}
                        compact={compact}
                    />
                </View>
                <View style={localStyles.notificationArea}>
                    {!isAnonymous && (
                        <MobileNotificationArea expandSecondaryBar={expandSecondaryBar} compact={compact} />
                    )}
                </View>
                <AssistantModeButton onOpen={() => expandedNavPicker && expandSecondaryBar()} />
            </View>

            {!isAnonymous && (
                <Animated.View
                    style={[localStyles.itemsContainerMobile, theme.itemsContainerMobile, { height: height }]}
                >
                    {expandedNavPicker &&
                        (compact ? (
                            <View style={localStyles.compactStatistics}>
                                <View style={localStyles.statisticsRow}>
                                    <XpBar size={XP_BAR_MOBILE} />
                                    <GoldArea />
                                </View>
                                <View style={localStyles.statisticsRow}>{statistics}</View>
                            </View>
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
    },
    statisticsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        height: SECONDARY_BAR_MOBILE,
    },
})
