import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'

const StaticProperty = ({ icon, name, value }) => (
    <View style={localStyles.container}>
        <View style={{ marginRight: 8 }}>
            <Icon name={icon} size={24} color={colors.Text03} />
        </View>
        <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{name}</Text>
        <View style={{ marginLeft: 'auto' }}>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{value}</Text>
        </View>
    </View>
)

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        flexDirection: 'row',
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})

export default StaticProperty
