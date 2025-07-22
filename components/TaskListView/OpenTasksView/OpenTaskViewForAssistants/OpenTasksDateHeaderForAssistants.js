import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function OpenTasksDateHeaderForAssistants({}) {
    const weekdays = [
        translate('Monday'),
        translate('Tuesday'),
        translate('Wednesday'),
        translate('Thursday'),
        translate('Friday'),
        translate('Saturday'),
        translate('Sunday'),
    ]

    const text = `TODAY • ${weekdays[moment().isoWeekday() - 1].toUpperCase()}`

    return (
        <View style={localStyles.container}>
            <View style={localStyles.innerContainer}>
                <View style={{ flex: 1, justifyContent: 'flex-start', flexDirection: 'row' }}>
                    <Text style={localStyles.dateText}>{text}</Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
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
        ...styles.overline,
        color: colors.Text02,
        zIndex: 1,
        paddingLeft: 12,
    },
})
