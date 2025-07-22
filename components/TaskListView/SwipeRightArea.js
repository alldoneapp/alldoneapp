import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function SwipeRightArea({ text }) {
    return (
        <View style={localStyles.rightSwipeArea}>
            <View style={localStyles.rightSwipeAreaContainer}>
                <Icon name="calendar" size={18} color={colors.UtilityYellow200} />
                <View style={{ marginLeft: 4 }}>
                    <Text style={[styles.subtitle2, { color: colors.UtilityYellow200 }]}>{translate(text)}</Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    rightSwipeAreaContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    rightSwipeArea: {
        flexDirection: 'row',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityYellow100,
        borderRadius: 4,
        paddingRight: 12,
    },
})
