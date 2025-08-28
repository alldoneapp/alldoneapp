import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function Header({ isLastUser }) {
    const headerText = 'Be careful, this action is permanent'
    const headerQuestion = isLastUser
        ? 'Do you really want to kick out this last user, take into account this action will delete also the project?'
        : 'Kicking this user will remove all content created by the user in the project'

    return (
        <View style={localStyles.header}>
            <Text style={[styles.title7, { color: '#ffffff' }]}>{translate(headerText)}</Text>
            <Text style={[styles.body2, { color: colors.Text03 }]}>{translate(headerQuestion)}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        paddingTop: 16,
        paddingHorizontal: 16,
    },
})
