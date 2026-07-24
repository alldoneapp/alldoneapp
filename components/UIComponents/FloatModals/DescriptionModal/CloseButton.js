import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function CloseButton({ closeModal }) {
    return (
        <View style={localStyles.closeContainer}>
            <Hotkeys keyName={'esc'} onKeyDown={(sht, event) => closeModal(event)} filter={e => true}>
                <TouchableOpacity
                    accessibilityLabel={'social-text-block'}
                    style={localStyles.closeButton}
                    onPress={() => closeModal()}
                >
                    <Icon accessibilityLabel={'social-text-block'} name="x" size={24} color={colors.Text03} />
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
