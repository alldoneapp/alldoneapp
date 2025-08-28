import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { getPersonalTrafficQuote, getPersonalXpQuote, PLAN_STATUS_PREMIUM } from '../../PremiumHelper'
import ProgressItem from './ProgressItem'

export default function PersonalProgressArea() {
    const loggedUserPremiumStatus = useSelector(state => state.loggedUser.premium.status)
    const monthlyXp = useSelector(state => state.loggedUser.monthlyXp)
    const monthlyTraffic = useSelector(state => state.loggedUser.monthlyTraffic)

    return (
        <View
            style={[localStyles.progressSection, loggedUserPremiumStatus === PLAN_STATUS_PREMIUM && { marginTop: 0 }]}
        >
            <ProgressItem text="Free app usage/month" percent={getPersonalXpQuote(monthlyXp)} />
            <ProgressItem text="Free traffic quota/month" percent={getPersonalTrafficQuote(monthlyTraffic)} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    progressSection: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 32,
    },
})
