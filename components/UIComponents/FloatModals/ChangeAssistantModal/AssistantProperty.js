import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import AssistantsWrapper from './AssistantsWrapper'

export default function AssistantProperty({ projectId, assistantId, disabled, objectId, objectType, header }) {
    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="cpu" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate(header ? header : 'Assistant')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <AssistantsWrapper
                    disabled={disabled}
                    projectId={projectId}
                    currentAssistantId={assistantId}
                    objectType={objectType}
                    objectId={objectId}
                />
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
})
