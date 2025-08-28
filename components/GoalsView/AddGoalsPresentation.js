import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function AddGoalsPresentation({ onPress }) {
    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.placeholder} onPress={onPress}>
                <Icon name="plus-square" size={24} color={colors.Primary100} />
                <Text style={localStyles.text}>{translate('Type to add new goal')}</Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 40,
        paddingLeft: 4,
    },
    placeholder: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
    tag: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        width: 'fit-content',
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
        marginLeft: 12,
    },
})
