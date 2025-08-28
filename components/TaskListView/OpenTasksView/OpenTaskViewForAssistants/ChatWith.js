import React from 'react'
import { Text, StyleSheet, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'

export default function ChatWith({ assistant }) {
    const createTopic = () => {
        createBotQuickTopic(assistant)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={createTopic}>
            <Icon name={'cpu'} size={24} color={colors.Text03} />
            <Text style={localStyles.name}>{translate('New chat with', { name: assistant.displayName })}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 9,
        minHeight: 48,
        backgroundColor: '#rgba(238, 238, 238, 0.24)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(238, 238, 238, 1)',
        shadowColor: 'rgba(0, 0, 0, 0.25)',
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 4,
        flexDirection: 'row',
        paddingHorizontal: 14,
        paddingVertical: 4,
        alignItems: 'center',
    },
    name: {
        ...styles.body1,
        color: '#000000',
        marginLeft: 28,
    },
})
