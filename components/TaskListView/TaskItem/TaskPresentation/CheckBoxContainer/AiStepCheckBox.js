import React from 'react'
import { StyleSheet, View } from 'react-native'

import Spinner from '../../../../UIComponents/Spinner'
import { colors } from '../../../../styles/global'

export default function AiStepCheckBox({ running }) {
    return running ? (
        <Spinner
            containerSize={24}
            spinnerSize={16}
            containerColor={colors.UtilityViolet100}
            spinnerColor={colors.UtilityViolet300}
        />
    ) : (
        <View style={localStyles.container}>
            <View style={localStyles.playIcon} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: colors.UtilityViolet300,
    },
    playIcon: {
        width: 0,
        height: 0,
        marginLeft: 2,
        borderTopWidth: 5,
        borderBottomWidth: 5,
        borderLeftWidth: 8,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: colors.UtilityViolet300,
    },
})
