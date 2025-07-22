import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native'

import XpBar, { XP_BAR_TABLET } from '../XpBar/XpBar'
import QuotaBar from './QuotaBar/QuotaBar'
import PremiumBar from './PremiumBar/PremiumBar'
import GoldArea from './GoldArea'
import TasksStatisticsArea from './TasksStatisticsArea'
import { PLAN_STATUS_PREMIUM } from '../Premium/PremiumHelper'

export default function TopBarStatisticArea() {
    const smallScreen = useSelector(state => state.smallScreen)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)

    return (
        <View style={localStyles.statisticArea}>
            {smallScreen ? (
                <XpBar key={'karma-bar-tablet'} size={XP_BAR_TABLET} />
            ) : (
                <XpBar key={'karma-bar-desktop'} />
            )}
            <GoldArea />
            <TasksStatisticsArea />
            {premiumStatus === PLAN_STATUS_PREMIUM ? <PremiumBar /> : <QuotaBar />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    statisticArea: {
        flexDirection: 'row',
    },
})
