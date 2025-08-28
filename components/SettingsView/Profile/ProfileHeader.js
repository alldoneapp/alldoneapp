import React from 'react'
import { StyleSheet, Text } from 'react-native'

import styles from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function ProfileHeader() {
    return <Text style={localStyles.text}>{translate('Profile')}</Text>
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.title6,
        marginTop: 32,
        marginBottom: 25,
    },
})
