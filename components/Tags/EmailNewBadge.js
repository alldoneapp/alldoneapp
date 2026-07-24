import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import styles, { colors } from '../styles/global'

export default function EmailNewBadge({ propStyles }) {
    return (
        <View style={[localStyles.badge, propStyles]} accessibilityLabel={translate('New')} testID="email-new-badge">
            <Text style={localStyles.text}>{translate('New')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    badge: {
        height: 20,
        paddingHorizontal: 7,
        borderRadius: 10,
        backgroundColor: colors.Gray500,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    text: {
        ...styles.caption2,
        color: '#FFFFFF',
        fontWeight: 'bold',
    },
})
