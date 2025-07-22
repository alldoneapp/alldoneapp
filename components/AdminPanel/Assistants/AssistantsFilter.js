import React, { useEffect, useRef } from 'react'
import { StyleSheet, View, TextInput } from 'react-native'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function AssistantsFilter({ filter, setFilter }) {
    const inputText = useRef()

    useEffect(() => {
        inputText.current.focus()
    }, [])

    return (
        <View style={localStyles.container}>
            <TextInput
                ref={inputText}
                value={filter}
                onChangeText={setFilter}
                style={localStyles.textInput}
                numberOfLines={1}
                multiline={false}
                placeholder={translate('Filter by name')}
                autoFocus={true}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 10,
    },
    textInput: {
        minWidth: 150,
        width: 357,
        height: 35,
        ...styles.body1,
        fontWeight: 400,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Gray400,
        paddingHorizontal: 16,
        marginRight: 10,
    },
})
