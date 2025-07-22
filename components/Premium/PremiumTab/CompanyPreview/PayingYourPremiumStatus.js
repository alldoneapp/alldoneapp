import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function PayingYourPremiumStatus({ pending }) {
    return (
        <View style={localStyles.status}>
            <Text style={styles.overlineNormal}>
                {translate(pending ? 'PROCESSING YOUR PREMIUM STATUS' : 'PAYING YOUR PREMIUM STATUS')}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    status: {
        alignSelf: 'center',
        textAlign: 'center',
        marginTop: 26,
        backgroundColor: colors.UtilityYellow200,
        borderRadius: 100,
        paddingHorizontal: 8,
        paddingVertical: 1,
    },
})
