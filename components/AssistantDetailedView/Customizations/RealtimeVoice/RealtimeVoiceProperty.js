import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import RealtimeVoiceWrapper from './RealtimeVoiceWrapper'

export default function RealtimeVoiceProperty({ disabled, projectId, assistant }) {
    return (
        <View style={localStyles.container}>
            <Icon name="volume-2" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Realtime call voice')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <RealtimeVoiceWrapper disabled={disabled} projectId={projectId} assistant={assistant} />
            </View>
        </View>
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
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
