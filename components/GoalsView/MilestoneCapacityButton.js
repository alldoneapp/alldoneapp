import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

export default function MilestoneCapacityButton({
    capacityButtonBackgroundColor,
    showCapacityView,
    toggleShowCapacityView,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <TouchableOpacity
            style={[
                localStyles.container,
                smallScreenNavigation && { paddingLeft: 4 },
                { backgroundColor: capacityButtonBackgroundColor },
            ]}
            onPress={toggleShowCapacityView}
        >
            {!smallScreenNavigation && <Text style={localStyles.date}>{translate('Capacity')}</Text>}
            <Icon name={showCapacityView ? 'chevron-down' : 'chevron-right'} size={16} color="#ffffff" />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        borderRadius: 12,
        paddingLeft: 8,
        paddingRight: 4,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
        marginTop: 4,
    },
    date: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginRight: 12,
    },
})
