import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CheckBox from '../../../CheckBox'
import { translate } from '../../../../i18n/TranslationService'

export default function AutoAdaptEstimation({ autoEstimation, setAutoEstimation }) {
    const toggleAutoEstimation = () => {
        setAutoEstimation(!autoEstimation)
    }

    return (
        <TouchableOpacity onPress={toggleAutoEstimation} style={localStyles.container}>
            <CheckBox
                externalContainerStyle={autoEstimation ? { borderWidth: 1 } : { backgroundColor: 'transparent' }}
                checked={autoEstimation}
            />
            {autoEstimation === null && <Text style={localStyles.questionIcon}>?</Text>}
            <Text style={localStyles.text}>{translate('Automatically adapt estimation')}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        alignSelf: 'flex-start',
        marginBottom: 16,
        paddingVertical: 8,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginLeft: 8,
    },
    questionIcon: {
        ...styles.subtitle1,
        color: colors.Text03,
        position: 'absolute',
        left: 24 - 15.5,
        top: 24 - 15,
        fontWeight: 'bold',
    },
})
