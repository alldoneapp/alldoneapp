import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import PropTypes from 'prop-types'
import styles, { colors } from '../styles/global'
import moment from 'moment'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../i18n/TranslationService'

function DateHeader({ dateText, isToday, isOverdue, date }) {
    const weekdays = [
        translate('Monday'),
        translate('Tuesday'),
        translate('Wednesday'),
        translate('Thursday'),
        translate('Friday'),
        translate('Saturday'),
        translate('Sunday'),
    ]
    const text = () => {
        let dayName = ''
        let upperCaseDateText = dateText.toUpperCase()

        if (date._isValid) {
            dayName = weekdays[moment(date).isoWeekday() - 1].toUpperCase()
            if (
                upperCaseDateText !== 'TODAY' &&
                upperCaseDateText !== 'TOMORROW' &&
                upperCaseDateText !== 'YESTERDAY'
            ) {
                upperCaseDateText = date.format(getDateFormat())
            } else {
                upperCaseDateText = translate(upperCaseDateText)
            }
        }
        return `${upperCaseDateText} • ${dayName}`
    }

    return (
        <View
            style={[
                localStyles.container,
                isToday && localStyles.containerToday,
                isOverdue && localStyles.overdueContainer,
            ]}
        >
            <View style={[localStyles.innerContainer, isOverdue && localStyles.overdueIContainer]}>
                <Text style={[styles.overline, isOverdue ? localStyles.overdueText : localStyles.dateText]}>
                    {text()}
                </Text>
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

DateHeader.propTypes = {
    dateText: PropTypes.string,
    isToday: PropTypes.bool,
    isOverdue: PropTypes.bool,
}

DateHeader.defaultProps = {
    dateText: 'Today',
    isToday: false,
    isOverdue: false,
}

export default DateHeader
