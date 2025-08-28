import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { Dismissible } from 'react-dismissible'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { translate } from '../../../i18n/TranslationService'
import { updateChatTitle } from '../../../utils/backends/Chats/chatsFirestore'

export default function ChatTitleEdition({ projectId, chat, closeTitleEdition, title, setTitle }) {
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const [textInput, setTextInput] = useState(title)

    const applyTitleChanges = () => {
        const cleanedName = textInput.trim()
        if (cleanedName !== title) {
            updateChatTitle(projectId, chat, cleanedName)
            setTitle(textInput)
        }
        closeTitleEdition()
    }

    const onInputKeyPress = key => {
        if (key === 'Enter') {
            applyTitleChanges()
        }
    }

    const cleanedName = textInput.trim()
    const disabledSaveButton = !cleanedName || cleanedName === title

    return (
        <View style={localStyles.container}>
            <View style={localStyles.textInputContainer}>
                <Dismissible disabled={showFloatPopup > 0} click={true} escape={true} onDismiss={closeTitleEdition}>
                    <CustomTextInput3
                        placeholder={translate('Write the name of the chat')}
                        onChangeText={text => setTextInput(text)}
                        initialTextExtended={title}
                        containerStyle={localStyles.textInput}
                        projectId={projectId}
                        onKeyPress={onInputKeyPress}
                        autoFocus={true}
                        forceTriggerEnterActionForBreakLines={applyTitleChanges}
                    />
                </Dismissible>
            </View>
            <View style={localStyles.buttonsContainer}>
                <Button
                    type={'secondary'}
                    icon={'x'}
                    buttonStyle={localStyles.secondaryBtn}
                    onPress={closeTitleEdition}
                />
                <Button type={'primary'} icon={'save'} disabled={disabledSaveButton} onPress={applyTitleChanges} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        marginTop: 28,
    },
    textInputContainer: {
        flex: 1,
        borderWidth: 2,
        borderRadius: 4,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
        borderColor: colors.UtilityBlue200,
    },
    textInput: {
        paddingHorizontal: 14,
        paddingTop: 0,
    },
    buttonsContainer: {
        flexDirection: 'row',
    },
    secondaryBtn: {
        marginLeft: 8,
        marginRight: 8,
    },
})
