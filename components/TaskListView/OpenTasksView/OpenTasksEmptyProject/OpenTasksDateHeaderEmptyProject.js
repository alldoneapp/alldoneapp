import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { generateDateHeaderText } from '../../../../utils/EstimationHelper'

export default function OpenTasksDateHeaderEmptyProject({ projectId }) {
    const weekdays = [
        translate('Monday'),
        translate('Tuesday'),
        translate('Wednesday'),
        translate('Thursday'),
        translate('Friday'),
        translate('Saturday'),
        translate('Sunday'),
    ]

    const dayName = weekdays[moment().isoWeekday() - 1].toUpperCase()
    const upperCaseDateText = translate('Today'.toUpperCase())

    const text = generateDateHeaderText(projectId, upperCaseDateText, dayName, 0, 0)

    return (
        <View style={[localStyles.container, localStyles.containerToday]}>
            <View style={localStyles.innerContainer}>
                <View style={{ flex: 1, justifyContent: 'flex-start', flexDirection: 'row' }}>
                    <Text style={[styles.overline, localStyles.dateText]}>{text}</Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 24,
        paddingBottom: 8,
    },
    containerToday: {
        paddingTop: 8,
        paddingBottom: 8,
    },
    innerContainer: {
        flex: 1,
        justifyContent: 'space-between',
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderRadius: 4,
        height: 24,
        alignItems: 'center',
    },
    dateText: {
        color: colors.Text02,
        zIndex: 1,
        paddingLeft: 12,
    },
})
