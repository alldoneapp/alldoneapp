import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../i18n/TranslationService'
import { generateDateHeaderText } from '../../../utils/EstimationHelper'

export default function DateHeader({
    dateText,
    isToday,
    isOverdue,
    estimation,
    date,
    firstDateSection,
    amountTasks,
    projectId,
}) {
    const weekdays = [
        translate('Monday'),
        translate('Tuesday'),
        translate('Wednesday'),
        translate('Thursday'),
        translate('Friday'),
        translate('Saturday'),
        translate('Sunday'),
    ]

    let dayName = ''
    let upperCaseDateText = dateText.toUpperCase()
    if (date._isValid) {
        dayName = weekdays[moment(date).isoWeekday() - 1].toUpperCase()
        if (upperCaseDateText !== 'TODAY' && upperCaseDateText !== 'TOMORROW' && upperCaseDateText !== 'YESTERDAY') {
            upperCaseDateText = date.format(getDateFormat())
        } else {
            upperCaseDateText = translate(upperCaseDateText)
        }
    }

    const text = generateDateHeaderText(projectId, upperCaseDateText, dayName, estimation, amountTasks)

    return (
        <View
            style={[
                localStyles.container,
                isToday || firstDateSection ? localStyles.containerToday : undefined,
                isOverdue && localStyles.overdueContainer,
            ]}
        >
            <View style={[localStyles.innerContainer, isOverdue && localStyles.overdueIContainer]}>
                <View style={{ flex: 1, justifyContent: 'flex-start', flexDirection: 'row' }}>
                    <Text style={[styles.overline, isOverdue ? localStyles.overdueText : localStyles.dateText]}>
                        {text}
                    </Text>
                </View>
            </View>
        </View>
    )
}

DateHeader.defaultProps = {
    dateText: 'Today',
    isToday: false,
    isOverdue: false,
    amountTasks: 0,
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
    overdueContainer: {
        paddingTop: 26,
        paddingBottom: 2,
    },
    overdueIContainer: {
        height: 20,
        backgroundColor: '#FFFFFF',
    },
    dateText: {
        color: colors.Text02,
        zIndex: 1,
        paddingLeft: 12,
    },
    overdueText: {
        ...styles.body3,
        letterSpacing: 1.5,
        color: colors.Text03,
        textTransform: 'uppercase',
    },
})
