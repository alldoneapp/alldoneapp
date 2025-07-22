import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '../../styles/global'
import { getDayName, parseDate } from '../../../utils/HelperFunctions'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../i18n/TranslationService'

export default function DateLine({ date }) {
    let toShowDate = parseDate(date, getDateFormat())
    toShowDate =
        toShowDate.toLowerCase() === 'today' || toShowDate.toLowerCase() === 'tomorrow'
            ? translate(toShowDate)
            : toShowDate
    const dayName = translate(getDayName(date, false)).toUpperCase()
    return (
        <View style={[localStyles.container]}>
            <Text style={localStyles.text}>{`${toShowDate} • ${dayName}`}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flex: 1,
        backgroundColor: colors.Grey100,
        height: 24,
        maxHeight: 24,
        borderRadius: 4,
        marginTop: 8,
        paddingVertical: 2,
        paddingLeft: 12,
        marginBottom: 8,
    },
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 11,
        lineHeight: 20,
        letterSpacing: 1.5,
        color: colors.Text02,
    },
})
