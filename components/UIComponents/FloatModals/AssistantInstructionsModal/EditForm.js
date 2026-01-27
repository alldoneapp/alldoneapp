import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'

export default function EditForm({
    disabled,
    setInstructions,
    initialInstructions,
    maxInputHeight = 500,
    isMobile = false,
}) {
    const [text, setText] = useState(initialInstructions)

    const done = () => {
        setInstructions(text.trim())
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter' && !event.shiftKey) {
            done()
            event.preventDefault()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const inputContainerStyle = {
        ...localStyles.inputContainer,
        minHeight: isMobile ? 150 : 300,
        maxHeight: maxInputHeight,
    }

    return (
        <View style={localStyles.container}>
            <CustomScrollView style={inputContainerStyle} showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 8, minHeight: 38 }}>
                    <CustomTextInput3
                        placeholder={translate('Type to add instructions')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={setText}
                        multiline={true}
                        singleLine={false}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        initialTextExtended={initialInstructions}
                        styleTheme={COMMENT_MODAL_THEME}
                        keepBreakLines={true}
                        disabledTags={true}
                        disabledEdition={disabled}
                    />
                </View>
            </CustomScrollView>
            <View style={localStyles.buttonsContainer}>
                <Button
                    icon={'save'}
                    iconColor={'#ffffff'}
                    type={'primary'}
                    onPress={done}
                    shortcutText={'Enter'}
                    forceShowShortcut={true}
                    disabled={disabled}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 8,
        paddingBottom: 8,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
        justifyContent: 'flex-end',
    },
})
