import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

const PropertiesHeader = () => (
    <View style={localStyles.container}>
        <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Properties')}</Text>
    </View>
)

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
})

export default PropertiesHeader
