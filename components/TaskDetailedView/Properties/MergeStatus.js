import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { getMergeStatusLabel } from '../../../utils/MergeStatus'
import { openMergeRequest } from '../../Tags/MergeStatusTag'

export default function MergeStatus({ mergeRequest }) {
    const label = getMergeStatusLabel(mergeRequest?.status)
    if (!label || !mergeRequest?.url) return null

    const onPress = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        openMergeRequest(mergeRequest.url)
    }

    return (
        <TouchableOpacity
            accessible
            accessibilityLabel={`${translate('Merge status')}: ${translate(label)}`}
            accessibilityRole="link"
            onPress={onPress}
        >
            <View style={localStyles.container}>
                <View style={{ marginRight: 8 }}>
                    <Icon name="git-merge" size={24} color={colors.Violet300} />
                </View>
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Merge status')}</Text>
                <View style={localStyles.valueContainer}>
                    <Text style={[styles.subtitle2, localStyles.value]}>{translate(label)}</Text>
                    <Icon name="new-window" size={16} color={colors.Violet300} />
                </View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        flex: 1,
        flexDirection: 'row',
        height: 56,
        maxHeight: 56,
        minHeight: 56,
        paddingLeft: 8,
        paddingVertical: 8,
    },
    valueContainer: {
        alignItems: 'center',
        backgroundColor: colors.UtilityViolet125,
        borderRadius: 12,
        flexDirection: 'row',
        marginLeft: 'auto',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    value: {
        color: colors.Violet300,
        fontWeight: '600',
        marginRight: 6,
    },
})
