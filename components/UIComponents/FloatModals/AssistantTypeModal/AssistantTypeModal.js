import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import OptionItem from './OptionItem'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Line from '../GoalMilestoneModal/Line'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { TYPE_3RD_PARTY, TYPE_PROMPT_BASED } from '../../../AdminPanel/Assistants/assistantsHelper'

const options = [
    { text: 'Prompt based', option: TYPE_PROMPT_BASED, shortcutKey: '1' },
    { text: '3rd party', option: TYPE_3RD_PARTY, shortcutKey: '2' },
]

export default function AssistantTypeModal({
    closeModal,
    updatePrompt,
    updateThirdPartLink,
    initialType,
    initialPrompt,
    initialThirdPartLink,
}) {
    const [selectedOption, setSelectedOption] = useState(initialType)
    const [inputIsFocused, setInputIsFocused] = useState(true)
    const [prompt, setPrompt] = useState(initialPrompt)
    const [thirdPartLink, setThirdPartLink] = useState(initialThirdPartLink)

    const textInputRef = useRef(null)

    const [width, height] = useWindowSize()

    const updateChanges = () => {
        if (selectedOption === TYPE_PROMPT_BASED) updatePrompt(prompt.trim())
        if (selectedOption === TYPE_3RD_PARTY) updateThirdPartLink(thirdPartLink.trim())
        closeModal()
    }

    const updateInputFocuseState = () => {
        const inputIsFocused = document.activeElement.classList.contains('ql-editor')
        setInputIsFocused(inputIsFocused)
    }

    useEffect(() => {
        document.addEventListener('mouseup', updateInputFocuseState)
        document.addEventListener('mousedown', updateInputFocuseState)
        return () => {
            document.removeEventListener('mouseup', updateInputFocuseState)
            document.removeEventListener('mousedown', updateInputFocuseState)
        }
    })

    useEffect(() => {
        setInputIsFocused(true)
    }, [selectedOption])

    const onKeyDown = e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            updateChanges()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View>
            <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Assistant type')}
                        description={translate('Select and configure the type of assistant')}
                    />
                    {options.map(data => (
                        <OptionItem
                            key={data.option}
                            optionData={data}
                            setSelectedOption={setSelectedOption}
                            selectedOption={selectedOption}
                            disabledShorcut={inputIsFocused}
                        />
                    ))}
                    <Line />
                    <View style={[localStyles.section, { marginTop: 12 }]}>
                        <Text style={localStyles.roleLabel}>
                            {translate(selectedOption === TYPE_PROMPT_BASED ? 'Prompt' : '3rd party link')}
                        </Text>
                        <CustomTextInput3
                            ref={textInputRef}
                            key={selectedOption}
                            containerStyle={[localStyles.roleInput, localStyles.textarea]}
                            initialTextExtended={selectedOption === TYPE_PROMPT_BASED ? prompt : thirdPartLink}
                            placeholder={translate(
                                selectedOption === TYPE_PROMPT_BASED
                                    ? 'Add the prompt for the assistant'
                                    : 'Add the link to the 3rd party'
                            )}
                            placeholderTextColor={colors.Text03}
                            multiline={selectedOption === TYPE_PROMPT_BASED}
                            singleLine={selectedOption === TYPE_3RD_PARTY}
                            onChangeText={selectedOption === TYPE_PROMPT_BASED ? setPrompt : setThirdPartLink}
                            styleTheme={NEW_TOPIC_MODAL_THEME}
                            disabledTags={true}
                            autoFocus={true}
                        />
                    </View>
                    <Line style={localStyles.line} />
                    <View style={localStyles.buttonContainer}>
                        <Button title={translate('Update')} type={'primary'} onPress={updateChanges} />
                    </View>
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    line: {
        marginTop: 16,
    },
    buttonContainer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
    section: {
        flex: 1,
    },
    roleLabel: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    roleInput: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 42,
        maxHeight: 42,
    },
    textarea: {
        minHeight: 96,
        maxHeight: 96,
    },
})
