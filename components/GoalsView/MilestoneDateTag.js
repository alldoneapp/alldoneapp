import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../i18n/TranslationService'

export default function MilestoneDateTag({ date, inDetailedView, style, onMilestoneTagClick }) {
    const dateText = date === 'Someday' ? translate('Someday') : date.format(getDateFormat())
    return (
        <TouchableOpacity
            disabled={!onMilestoneTagClick}
            onPress={onMilestoneTagClick}
            style={[inDetailedView ? localStyles.containerDetailedView : localStyles.container, style]}
        >
            <Icon name="milestone-2" size={inDetailedView ? 16 : 18} color={colors.Primary300} />
            <Text style={[inDetailedView ? localStyles.dateDetailedView : localStyles.date]}>{dateText}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 30,
        borderRadius: 15,
        paddingLeft: 6,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.UtilityBlue100,
        marginRight: 8,
    },
    containerDetailedView: {
        height: 24,
        borderRadius: 12,
        paddingLeft: 4,
        paddingRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.UtilityBlue100,
    },
    date: {
        ...styles.subtitle1,
        color: colors.Primary300,
        marginLeft: 6,
    },
    dateDetailedView: {
        ...styles.subtitle2,
        color: colors.Primary300,
        marginLeft: 4,
    },
})
