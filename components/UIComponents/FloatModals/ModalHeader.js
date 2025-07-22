import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import CloseButton from '../../FollowUp/CloseButton'

export default function ModalHeader({
    closeModal,
    title,
    description,
    description2,
    containerStyle,
    disabledEscape,
    hideCloseButton,
}) {
    return (
        <View style={containerStyle}>
            {!hideCloseButton && (
                <CloseButton style={localStyles.closeButton} close={closeModal} disabledEscape={disabledEscape} />
            )}
            <Text style={localStyles.title}>{title}</Text>
            {!!description && (
                <Text style={[localStyles.description, description2 && { marginBottom: 16 }]}>{description}</Text>
            )}
            {!!description2 && <Text style={localStyles.description}>{description2}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 20,
    },
    closeButton: {
        top: -8,
        right: -8,
    },
})
