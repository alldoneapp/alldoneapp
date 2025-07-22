import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import global, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'

export default function FeatureDescription({ text }) {
    return (
        <View style={localStyles.rows}>
            <Icon name="check" color={colors.Primary100} />
            <Text style={localStyles.items}>{translate(text)}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    rows: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    items: {
        ...global.body2,
        color: colors.Gray500,
        marginLeft: 6,
    },
})
