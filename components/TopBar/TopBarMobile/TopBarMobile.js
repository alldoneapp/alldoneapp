import React, { useContext, useRef, useEffect, useState } from 'react'
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
import HomeButton, { HOME_BUTTON_WIDTH } from '../HomeButton'
import AnnaViewSwitch, {
    ANNA_VIEW_SWITCH_HEIGHT,
    ANNA_VIEW_SWITCH_WIDTH,
    AnnaViewSwitchContext,
} from '../../Anna/AnnaViewSwitch'

const SECONDARY_BAR_MOBILE = 36
const TOP_ROW_PADDING = 16
const HOME_BUTTON_GAP = 8

// Where the absolutely placed middle control (the Home button, or the assistant's view switch that
// replaces it inside AnnaShell) starts: centred, unless the buttons on the right (`rightWidth`) need
// the room on a narrow phone; then it moves left until it clears them.
export const getCenterLeft = (rowWidth, centerWidth = HOME_BUTTON_WIDTH, rightWidth = 0) =>
    Math.min(rowWidth / 2 - centerWidth / 2, rowWidth - TOP_ROW_PADDING - rightWidth - HOME_BUTTON_GAP - centerWidth)

// AT-3044: the left group (menu + Gold) must stop short of the middle control, so a long balance on
// a narrow phone shrinks instead of sliding under it.
export const getLeftAreaMaxWidth = (rowWidth, centerWidth = HOME_BUTTON_WIDTH, rightWidth = 0) =>
    rowWidth > 0
        ? Math.max(0, getCenterLeft(rowWidth, centerWidth, rightWidth) - TOP_ROW_PADDING - HOME_BUTTON_GAP)
        : undefined

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
    const [rightWidth, setRightWidth] = useState(0)
    // Inside AnnaShell on a phone: the Anna | App switch in the middle, in place of the Home button.
    const viewSwitch = useContext(AnnaViewSwitchContext)
    const centerWidth = viewSwitch ? ANNA_VIEW_SWITCH_WIDTH : HOME_BUTTON_WIDTH
    const leftAreaMaxWidth = getLeftAreaMaxWidth(rowWidth, centerWidth, rightWidth)
    const centerPosition =
        rowWidth > 0 ? { left: getCenterLeft(rowWidth, centerWidth, rightWidth), marginLeft: 0 } : null

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
                <View
                    testID="top-bar-mobile-right"
                    style={localStyles.notificationArea}
                    onLayout={({ nativeEvent }) => setRightWidth(nativeEvent.layout.width)}
                >
                    {!isAnonymous && (
                        <MobileNotificationArea expandSecondaryBar={expandSecondaryBar} compact={compact} />
                    )}
                </View>
                {viewSwitch ? (
                    <View style={[localStyles.viewSwitch, centerPosition]} testID="top-bar-mobile-view-switch">
                        <AnnaViewSwitch
                            {...viewSwitch}
                            iconsOnly
                            onSelect={next => {
                                if (expandedNavPicker) expandSecondaryBar()
                                viewSwitch.onSelect(next)
                            }}
                        />
                    </View>
                ) : (
                    <HomeButton
                        color={theme.homeIcon}
                        style={[localStyles.homeButton, centerPosition]}
                        expandSecondaryBar={expandSecondaryBar}
                    />
                )}
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
                                {statistics}
                            </ScrollView>
                        ) : (
                            statistics
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
    viewSwitch: {
        position: 'absolute',
        left: '50%',
        marginLeft: -ANNA_VIEW_SWITCH_WIDTH / 2,
        top: (56 - ANNA_VIEW_SWITCH_HEIGHT) / 2,
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
})
