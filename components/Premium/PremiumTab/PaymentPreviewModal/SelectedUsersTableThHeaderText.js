import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function SelectedUsersTableThHeaderText({ text1, text2 }) {
    return (
        <View style={{ flexDirection: 'column' }}>
            <Text style={localStyles.header}>{translate(text1)}</Text>
            <Text style={localStyles.header}>{translate(text2)}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        ...styles.subtitle2,
        color: '#fff',
    },
})
