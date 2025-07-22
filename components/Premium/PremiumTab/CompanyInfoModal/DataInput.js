import React, { useEffect } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function DataInput({
    autofocus,
    inputRef,
    headerText,
    placeholder,
    plainPlaceholder,
    value,
    setValue,
    externalInputStyle,
    externalContainerStyle,
    keyboardType,
}) {
    useEffect(() => {
        if (autofocus) inputRef.current.focus()
    }, [])

    return (
        <View style={externalContainerStyle}>
            {headerText && <Text style={localStyles.inputHeaderText}>{translate(headerText)}</Text>}
            <TextInput
                ref={inputRef}
                style={[localStyles.inputStyle, externalInputStyle]}
                placeholder={plainPlaceholder ? plainPlaceholder : translate(placeholder)}
                placeholderTextColor={colors.Text03}
                value={value}
                onChangeText={setValue}
                autoFocus={autofocus}
                keyboardType={keyboardType}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    inputHeaderText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    inputStyle: {
        ...styles.body1,
        color: 'white',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Gray400,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginTop: 4,
    },
})
