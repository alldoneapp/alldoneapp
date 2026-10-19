import React, { useContext } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import AnnaChatNavigationContext from '../Anna/AnnaChatNavigationContext'
import { translate } from '../../i18n/TranslationService'

export default function AssistantModeButton({ onOpen, inline = false }) {
    const assistant = useSelector(state => state.defaultAssistant)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const showChat = useContext(AnnaChatNavigationContext)

    if (isAnonymous || !assistant?.uid) return null

    const name = assistant.displayName?.trim() || translate('Assistant')
    const label = `${name}: ${translate('Open assistant chat')}`
    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={label}
            testID="top-bar-assistant-mode"
            style={[localStyles.button, !inline && localStyles.centered]}
            onPress={() => {
                onOpen?.()
                showChat()
            }}
        >
            <AssistantAvatar
                photoURL={assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL}
                assistantId={assistant.uid}
                size={28}
            />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 20,
    },
    centered: {
        position: 'absolute',
        left: '50%',
        marginLeft: -20,
        top: 8,
    },
})
