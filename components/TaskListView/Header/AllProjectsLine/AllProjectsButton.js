import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function AllProjectsButton({ onPress }) {
    return (
        <TouchableOpacity style={localStyles.titleContainer} onPress={onPress} accessible={false}>
            <Text style={localStyles.text} numberOfLines={1}>
                {translate('All projects')}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
        flex: 1,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
})
