import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function AddVariable({ openVariableModal }) {
    const onPress = () => {
        openVariableModal(null)
    }

    return (
        <View style={localStyles.addVariableContainer}>
            <TouchableOpacity style={localStyles.addVariableButton} onPress={onPress}>
                <Text style={localStyles.text}>{translate('Add variable')}</Text>
                <Icon name="plus-square" color={colors.Text02} size={24} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginRight: 8,
    },
    addVariableContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    addVariableButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
})
