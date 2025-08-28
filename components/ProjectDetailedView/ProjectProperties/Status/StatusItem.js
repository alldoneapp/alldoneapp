import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function StatusItem({ selectStatus, icon, text, containerStyle, currentStatus, itemStatus }) {
    return (
        <TouchableOpacity
            onPress={() => {
                selectStatus(itemStatus)
            }}
            style={[localStyles.container, containerStyle]}
        >
            <View style={localStyles.options}>
                <Icon name={icon} size={24} color="#fff" style={{ marginRight: 16 }} />
                <Text style={localStyles.itemHeader}>{translate(text)}</Text>
                {currentStatus === itemStatus && (
                    <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingVertical: 12,
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
