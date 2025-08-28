import React, { useEffect, useRef } from 'react'

import { StyleSheet, Text, TextInput } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function CustomEstimationModalOption({ value, setValue, heading, placeholder, startFocus }) {
    const inputRef = useRef()

    const checkField = (number, maxLength = 5) => {
        return !isNaN(number) && number.length <= maxLength
    }

    const onChangeText = text => {
        checkField(text) && setValue(text)
    }

    useEffect(() => {
        if (startFocus) inputRef.current.focus()
    }, [])

    return (
        <>
            <Text style={localStyles.heading}>{translate(heading)}</Text>
            <TextInput
                ref={inputRef}
                style={localStyles.input}
                placeholderTextColor={colors.Text03}
                placeholder={translate(placeholder)}
                keyboardType={'numeric'}
                value={value}
                onChangeText={onChangeText}
            />
        </>
    )
}

const localStyles = StyleSheet.create({
    input: {
        ...styles.body1,
        flex: 1,
        height: 40,
        color: '#ffffff',
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 16,
        marginBottom: 8,
    },
    heading: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginTop: 4,
        marginBottom: 4,
    },
})
