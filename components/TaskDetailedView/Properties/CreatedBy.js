import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Creator from './Creator'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function CreatedBy({ createdDate, creator }) {
    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="user" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Owner')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Creator createdDate={createdDate} creator={creator} />
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
