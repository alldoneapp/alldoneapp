import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import styles, { colors } from '../../../../styles/global'
import { useSelector } from 'react-redux'
import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'

export default function SearchForm({ setText, blurOnArrow = false }) {
    const searchText = useSelector(state => state.searchText)
    const [localText, setLocalText] = useState(searchText)
    const inputRef = useRef()

    const onChangeText = value => {
        setLocalText(value)
        setText?.(value)
    }

    useEffect(() => {
        setTimeout(() => {
            inputRef?.current?.focus()
        }, 100)
    }, [])

    const onEscapeKey = ({ key }) => {
        if (key === 'Escape') {
            inputRef?.current?.blur()
            onChangeText('')
        }
        if (blurOnArrow && (key === 'ArrowDown' || key === 'ArrowUp')) {
            inputRef?.current?.blur()
        }
    }

    const cancelFilter = e => {
        e?.preventDefault()
        e?.stopPropagation()
        inputRef?.current?.focus()
        onChangeText('')
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.inputContainer}>
                <TextInput
                    ref={inputRef}
                    style={localStyles.input}
                    autoFocus={true}
                    placeholder={`${translate('Filter')}...`}
                    placeholderTextColor={colors.Text03}
                    onChangeText={onChangeText}
                    value={localText}
                    onKeyPress={onEscapeKey}
                />
            </View>
            <View style={localText.trim() === '' && { opacity: 0.5 }}>
                <Button
                    type={'primary'}
                    icon={'x'}
                    onPress={localText.trim() !== '' && cancelFilter}
                    shortcutText={'Esc'}
                    forceShowShortcut={true}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
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
