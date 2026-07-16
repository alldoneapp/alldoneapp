import React from 'react'
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getMergeStatusLabel } from '../../utils/MergeStatus'

export function openMergeRequest(url) {
    if (!url) return
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank')
        return
    }
    Linking.openURL(url).catch(() => {})
}

export default function MergeStatusTag({ mergeRequest, style, disabled = false }) {
    const label = getMergeStatusLabel(mergeRequest?.status)
    if (!label || !mergeRequest?.url) return null

    const onPress = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        openMergeRequest(mergeRequest.url)
    }

    return (
        <TouchableOpacity disabled={disabled} onPress={onPress} accessibilityRole="link">
            <View accessibilityLabel={label} style={[localStyles.container, style]}>
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{translate(label)}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        backgroundColor: colors.UtilityViolet125,
        borderRadius: 12,
        flexDirection: 'row',
        height: 24,
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    text: {
        color: colors.Violet300,
        marginVertical: 1,
    },
})
