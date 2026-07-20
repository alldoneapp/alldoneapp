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

const SECONDARY_BAR_MOBILE = 36

export default function TopBarMobile() {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const expandedNavPicker = useSelector(state => state.expandedNavPicker)
    const height = useRef(new Animated.Value(0)).current

    const theme = getTheme(Themes, themeName, 'TopBarMobile')

    const toggleNavPickerOff = () => {
        dispatch(toggleNavPicker(false))
    }

    const toggleNavPickerOn = () => {
        dispatch(toggleNavPicker(true))
    }

    const expandSecondaryBar = () => {
        if (expandedNavPicker) {
            Animated.timing(
                // Animate value over time
                height, // The value to drive
                {
                    toValue: 0, // Animate to final value
                    duration: 200,
                }
            ).start(toggleNavPickerOff) // Start the animation
        } else {
            Animated.timing(
                // Animate value over time
                height, // The value to drive
                {
                    toValue: SECONDARY_BAR_MOBILE, // Animate to final value
                    duration: 200,
                }
            ).start(toggleNavPickerOn) // Start the animation
        }
    }

    useEffect(() => {
        if (expandedNavPicker) dispatch(toggleNavPicker(false))
    }, [])

    return (
        <View>
            <View style={[localStyles.container, theme.container]}>
                <View style={localStyles.statisticArea}>
                    <TopBarMobileStatisticArea expandSecondaryBar={expandSecondaryBar} />
                </View>
                <View style={localStyles.notificationArea}>
                    {!isAnonymous && <MobileNotificationArea expandSecondaryBar={expandSecondaryBar} />}
                </View>
            </View>

            {!isAnonymous && (
                <Animated.View
                    style={[localStyles.itemsContainerMobile, theme.itemsContainerMobile, { height: height }]}
                >
                    {expandedNavPicker && (
                        <>
                            {!isAnonymous && <XpBar key={'karma-bar-tablet'} size={XP_BAR_MOBILE} />}
                            <TasksStatisticsArea />
                            {premiumStatus === PLAN_STATUS_PREMIUM ? (
                                <PremiumBar size={QUOTA_BAR_MOBILE} />
                            ) : (
                                <QuotaBar size={QUOTA_BAR_MOBILE} />
                            )}
                        </>
                    )}
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
})
