import React from 'react'
import { Text, StyleSheet } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function DateText({ selected, date, withDot }) {
    return (
        <Text style={selected ? localStyles.selected : localStyles.notSelected}>
            {withDot && ' • '}
            {date === BACKLOG_DATE_NUMERIC ? translate('Someday') : date.format('D MMM')}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    selected: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    notSelected: {
        ...styles.body1,
        color: colors.Text03,
    },
})
