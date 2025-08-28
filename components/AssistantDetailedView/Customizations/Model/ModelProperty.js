import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import ModelWrapper from './ModelWrapper'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'

export default function ModelProperty({ disabled, projectId, assistant }) {
    return (
        <View style={localStyles.container}>
            <Icon name="crop" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Model used')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <ModelWrapper disabled={disabled} projectId={projectId} assistant={assistant} />
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
    button: {
        marginHorizontal: 0,
    },
})
