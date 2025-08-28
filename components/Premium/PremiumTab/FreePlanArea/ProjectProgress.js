import React from 'react'
import { StyleSheet, View } from 'react-native'

import { getProjectTrafficQuote, getProjectXpQuote } from '../../PremiumHelper'
import ProgressItem from './ProgressItem'

export default function ProjectProgress({ monthlyXp, monthlyTraffic, containerStyle }) {
    return (
        <View style={[localStyles.projectProgressSection, containerStyle]}>
            <ProgressItem text="Free project usage/month" percent={getProjectXpQuote(monthlyXp)} />
            <ProgressItem text="Free traffic quota/month" percent={getProjectTrafficQuote(monthlyTraffic)} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    projectProgressSection: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
})
