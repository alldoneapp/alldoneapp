import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function Active() {
    return (
        <View style={localStyles.active}>
            <Text style={[styles.subtitle1, { color: '#fff' }]}>{translate('ACTIVE')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    active: {
        marginTop: 25,
        borderRadius: 100,
        backgroundColor: colors.Primary100,
        height: 24,
        width: 74,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
