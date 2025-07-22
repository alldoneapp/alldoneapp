import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector, shallowEqual } from 'react-redux'

import styles from '../../styles/global'
import {
    getPersonalTrafficQuote,
    getPersonalXpQuote,
    getProjectTrafficQuote,
    getProjectXpQuote,
} from '../../Premium/PremiumHelper'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'

export const QUOTA_BAR_MOBILE = 0
export const QUOTA_BAR_NORMAL = 1

export default function Percent() {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const monthlyXp = useSelector(state => state.loggedUser.monthlyXp)
    const monthlyTraffic = useSelector(state => state.loggedUser.monthlyTraffic)
    const projectsMonthlyXp = useSelector(
        state => state.loggedUserProjects.map(project => project.monthlyXp),
        shallowEqual
    )
    const projectsMonthlyTraffic = useSelector(
        state => state.loggedUserProjects.map(project => project.monthlyTraffic),
        shallowEqual
    )

    const getHigherXpPercent = () => {
        let higherPercent = getPersonalXpQuote(monthlyXp)

        for (let i = 0; i < projectsMonthlyXp.length; i++) {
            const projectmonthlyXp = projectsMonthlyXp[i]
            const projectPercent = getProjectXpQuote(projectmonthlyXp)
            if (projectPercent > higherPercent) higherPercent = projectPercent
        }

        return higherPercent
    }

    const getHigherTrafficPercent = () => {
        let higherPercent = getPersonalTrafficQuote(monthlyTraffic)

        for (let i = 0; i < projectsMonthlyTraffic.length; i++) {
            const projectmonthlyTraffic = projectsMonthlyTraffic[i]
            const projectPercent = getProjectTrafficQuote(projectmonthlyTraffic)
            if (projectPercent > higherPercent) higherPercent = projectPercent
        }

        return higherPercent
    }

    const getHigherPercent = () => {
        const higherXpPercent = getHigherXpPercent()
        const higherTrafficPercent = getHigherTrafficPercent()
        const higherPercent = higherXpPercent > higherTrafficPercent ? higherXpPercent : higherTrafficPercent
        return higherPercent
    }

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.QuotaBar')
    const higherPercent = getHigherPercent()

    return <Text style={[localStyles.value, theme.value]}>{`${higherPercent}%`}</Text>
}

const localStyles = StyleSheet.create({
    value: {
        ...styles.caption2,
        marginLeft: 8,
    },
})
