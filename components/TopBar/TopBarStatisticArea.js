import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native'

import XpBar, { XP_BAR_TABLET } from '../XpBar/XpBar'
import QuotaBar from './QuotaBar/QuotaBar'
import PremiumBar from './PremiumBar/PremiumBar'
import GoldArea from './GoldArea'
import TasksStatisticsArea from './TasksStatisticsArea'
import { PLAN_STATUS_PREMIUM } from '../Premium/PremiumHelper'

// `showTasksStatistics`: AnnaTopStrip drops the done-task count in a window too narrow for the chat
// beside Alldone, where it would run into the view switch in the middle. `compact`: icons instead of
// labels, when the strip's left side would otherwise run into the switch. `showXp`: the strip drops the
// XP bar first when it is short of room.
export default function TopBarStatisticArea({ showTasksStatistics = true, compact, showXp = true }) {
    // AnnaTopStrip passes `compact` from its own room: there Alldone's small-screen flag, measured
    // on the pane beside the chat, must not shrink the statistics in a strip that has the room.
    const smallScreenFlag = useSelector(state => state.smallScreen)
    const smallScreen = compact ?? smallScreenFlag
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)

    return (
        <View style={localStyles.statisticArea}>
            {showXp &&
                (smallScreen ? (
                    <XpBar key={'karma-bar-tablet'} size={XP_BAR_TABLET} compact />
                ) : (
                    <XpBar key={'karma-bar-desktop'} compact />
                ))}
            <GoldArea containerStyle={{ marginRight: smallScreen ? 4 : 8 }} />
            {showTasksStatistics && <TasksStatisticsArea compact={compact} />}
            {premiumStatus === PLAN_STATUS_PREMIUM ? <PremiumBar compact={compact} /> : <QuotaBar compact={compact} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    statisticArea: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
    },
})
