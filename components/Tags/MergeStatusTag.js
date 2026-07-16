import React from 'react'
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getMergeStatusLabel } from '../../utils/MergeStatus'

function getSafeExternalUrl(url) {
    if (typeof url !== 'string') return null
    const exactUrl = url.trim()

    try {
        const parsed = new URL(exactUrl)
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? exactUrl : null
    } catch (_) {
        return null
    }
}

export function openMergeRequest(url) {
    // The backend stores the canonical provider URL. Validate it, but deliberately do
    // not derive or rebuild a provider URL in the client.
    const exactUrl = getSafeExternalUrl(url)
    if (!exactUrl) return

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.open) {
        const newWindow = window.open(exactUrl, '_blank', 'noopener,noreferrer')
        if (newWindow) newWindow.opener = null
        return
    }
    Linking.openURL(exactUrl).catch(() => {})
}

export default function MergeStatusTag({ mergeRequest, style, disabled = false }) {
    const label = getMergeStatusLabel(mergeRequest?.status)
    if (!label || !mergeRequest?.url) return null

    const onPress = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        openMergeRequest(mergeRequest.url)
    }

    const accessibilityLabel = `${translate('Merge status')}: ${translate(label)}`

    return (
        <TouchableOpacity
            accessible
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="link"
            disabled={disabled}
            onPress={onPress}
        >
            <View style={[localStyles.container, style]}>
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
