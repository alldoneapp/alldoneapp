import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles from '../../../styles/global'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'

export default function Header({ closeModal, editing }) {
    const title = translate(editing ? 'Edit task' : 'Add new task')
    return (
        <View>
            <CloseButton style={localStyles.closeButton} close={closeModal} />
            <Text style={localStyles.title}>{title}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    title: {
        ...styles.title7,
        color: '#ffffff',
        marginTop: 8,
        marginLeft: 8,
        marginBottom: 16,
    },
    closeButton: {
        top: 0,
        right: 0,
    },
})
