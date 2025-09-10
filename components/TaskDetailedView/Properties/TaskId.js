import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { copyTextToClipboard } from '../../../utils/HelperFunctions'

export default function TaskId({ task }) {
    const copyToClipboard = () => {
        if (task.humanReadableId) {
            copyTextToClipboard(task.humanReadableId)
        }
    }

    if (!task.humanReadableId) {
        return null
    }

    return (
        <TouchableOpacity onPress={copyToClipboard}>
            <View style={localStyles.container}>
                <View style={{ marginRight: 8 }}>
                    <Icon name="hashtag" size={24} color={colors.Text03} />
                </View>
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Task ID')}</Text>
                <View style={{ marginLeft: 'auto' }}>
                    <Text style={[styles.subtitle2, { color: colors.Text01, fontWeight: '600' }]}>
                        {task.humanReadableId}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
