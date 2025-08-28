import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function SwipeLeftArea({ text }) {
    return (
        <View style={localStyles.leftSwipeArea}>
            <Icon name="circle-details" size={18} color={colors.UtilityGreen200} />
            <View style={{ marginLeft: 4 }}>
                <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>{translate(text)}</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    leftSwipeArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
        paddingLeft: 12,
    },
})
