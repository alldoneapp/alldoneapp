import React from 'react'
import { StyleSheet, View } from 'react-native'

import Icon from '../../../../Icon'
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
            <Icon name="star" size={16} color={colors.UtilityViolet300} accessibilityLabel="AI" />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        backgroundColor: colors.UtilityViolet100,
    },
})
