import React from 'react'
import { Text, StyleSheet } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import { formatDueDate } from './formatDueDate'

export default function DateText({ selected, date, withDot }) {
    return (
        <Text style={selected ? localStyles.selected : localStyles.notSelected}>
            {withDot && ' • '}
            {date === BACKLOG_DATE_NUMERIC ? translate('Someday') : formatDueDate(date)}
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
