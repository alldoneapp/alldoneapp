import React from 'react'
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native'

import { translate } from '../../../../../i18n/TranslationService'
import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'

export default function AddSkillPresentation({ onPress }) {
    return (
        <View style={localStyles.container}>
            <TouchableOpacity style={localStyles.placeholder} onPress={onPress}>
                <Icon name="plus-square" size={24} color={colors.Primary100} />
                <Text style={localStyles.text}>{translate('Type to add new skill')}</Text>
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
    text: {
        ...styles.body1,
        color: colors.Text03,
        marginLeft: 12,
    },
})
