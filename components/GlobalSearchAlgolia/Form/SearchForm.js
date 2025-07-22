import React, { useEffect } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import Button from '../../UIControls/Button'
import styles, { colors } from '../../styles/global'

export default function SearchForm({
    onPressButton,
    localText,
    setLocalText,
    searchInputRef,
    showShortcuts,
    containerStyle,
    placeholder,
    buttonIcon,
    disabledButton,
}) {
    useEffect(() => {
        setTimeout(() => {
            searchInputRef.current?.focus()
        }, 300)
    }, [])

    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <TextInput
                    ref={searchInputRef}
                    style={localStyles.input}
                    autoFocus={true}
                    placeholder={placeholder}
                    placeholderTextColor={colors.Text03}
                    onChangeText={setLocalText}
                    value={localText}
                />
            </View>
            <View>
                <Button
                    type={'primary'}
                    icon={buttonIcon}
                    onPress={onPressButton}
                    shortcutText={'Enter'}
                    disabled={disabledButton || localText.trim() === ''}
                    forceShowShortcutForReal={showShortcuts}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        paddingHorizontal: 16,
    },
    inputContainer: {
        flex: 1,
        marginRight: 8,
    },
    input: {
        ...styles.body1,
        borderWidth: 1,
        borderColor: colors.Gray400,
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 16,
        color: '#ffffff',
        maxHeight: 40,
    },
})
