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
        // Buffer keystrokes that arrive before the input is focused,
        // so nothing the user types is lost during modal open animation.
        const buffered = []
        const handleEarlyKeystroke = e => {
            if (
                e.key.length === 1 &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                document.activeElement !== searchInputRef.current
            ) {
                buffered.push(e.key)
                e.preventDefault()
            }
        }
        document.addEventListener('keydown', handleEarlyKeystroke, true)

        const tryFocus = () => {
            if (searchInputRef.current) {
                searchInputRef.current.focus()
                if (buffered.length > 0) {
                    setLocalText(prev => prev + buffered.join(''))
                    buffered.length = 0
                }
                document.removeEventListener('keydown', handleEarlyKeystroke, true)
            }
        }

        // Try focusing immediately, then retry at short intervals
        tryFocus()
        const interval = setInterval(() => {
            tryFocus()
        }, 50)

        const cleanup = setTimeout(() => {
            clearInterval(interval)
            document.removeEventListener('keydown', handleEarlyKeystroke, true)
        }, 500)

        return () => {
            clearInterval(interval)
            clearTimeout(cleanup)
            document.removeEventListener('keydown', handleEarlyKeystroke, true)
        }
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
