import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'

export default function WildcardImage() {
    return (
        <View style={localStyles.container}>
            <Icon name="image" color="#B8BFC8" size={40} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxWidth: 368,
        height: 200,
        backgroundColor: colors.Gray300,
        borderRadius: 8,
        alignContent: 'center',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
