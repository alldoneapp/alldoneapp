import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function InvitePeopleModalOption({ selectOption, icon, text, tab }) {
    const onPress = () => {
        selectOption(tab)
    }

    return (
        <TouchableOpacity onPress={onPress} style={localStyles.container}>
            <View style={localStyles.options}>
                <Icon name={icon} size={24} color="#fff" style={{ marginRight: 16 }} />
                <Text style={localStyles.itemHeader}>{translate(text)}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingVertical: 12,
        marginBottom: 8,
    },
    options: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    itemHeader: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
