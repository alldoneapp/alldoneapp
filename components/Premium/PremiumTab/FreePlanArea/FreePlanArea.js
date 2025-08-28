import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import ProjectsProgressArea from './ProjectsProgressArea'
import PersonalProgressArea from './PersonalProgressArea'
import FreePlanDescription from './FreePlanDescription'
import Active from './Active'
import { PLAN_STATUS_FREE } from '../../PremiumHelper'

export default function FreePlanArea() {
    const loggedUserPremiumStatus = useSelector(state => state.loggedUser.premium.status)
    return (
        <View style={localStyles.box}>
            {loggedUserPremiumStatus === PLAN_STATUS_FREE && <FreePlanDescription />}
            <PersonalProgressArea />
            <ProjectsProgressArea />
            {loggedUserPremiumStatus === PLAN_STATUS_FREE && <Active />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    box: {
        borderWidth: 1,
        borderColor: colors.Gray200,
        borderRadius: 4,
        paddingVertical: 16,
        marginBottom: 12,
        backgroundColor: colors.Grey100,
    },
})
