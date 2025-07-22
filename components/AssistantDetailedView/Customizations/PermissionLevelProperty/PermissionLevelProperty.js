import React from 'react'
import { StyleSheet, View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'

export default function PermissionLevelProperty({ isGlobal, fromTemplate }) {
    const getType = () => {
        if (isGlobal) return 'Global'
        if (fromTemplate) return 'Community'
        return 'Project'
    }

    return (
        <View style={localStyles.container}>
            <Icon name="fingerprint" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Permission Level')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Button
                    type={'ghost'}
                    icon={'fingerprint'}
                    onPress={() => {}}
                    disabled={true}
                    title={translate(getType())}
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
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
