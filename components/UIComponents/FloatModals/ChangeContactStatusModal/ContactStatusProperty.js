import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import ContactStatusWrapper from './ContactStatusWrapper'

export default function ContactStatusProperty({ projectId, contactStatusId, disabled, contact }) {
    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="tag" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Status')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <ContactStatusWrapper
                    disabled={disabled}
                    projectId={projectId}
                    currentStatusId={contactStatusId}
                    contact={contact}
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
