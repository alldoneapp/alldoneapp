import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'

export default function UserDescriptionField({
    description,
    onSave,
    projectId,
    projectIndex,
    disabled = false,
    placeholder = 'Type the user description here',
    helperText = '',
}) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const inputRef = useRef()
    const [mentionsModalActive, setMentionsModalActive] = useState(false)

    const savedDescription = description || ''
    const [descriptionText, setDescriptionText] = useState(savedDescription)

    useEffect(() => {
        setDescriptionText(savedDescription)
    }, [savedDescription])

    const updateDescription = async () => {
        if (!onSave) return

        const trimmedDescription = descriptionText.trim()
        await onSave(trimmedDescription)
        setDescriptionText(trimmedDescription)
    }

    const onKeyDown = event => {
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !mentionsModalActive &&
            inputRef.current?.isFocused?.() &&
            !blockShortcuts &&
            !disabled
        ) {
            updateDescription()
        }
    }

    useEffect(() => {
        if (typeof document === 'undefined') return

        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.header}>{translate('Description')}</Text>
            <View style={localStyles.inputContainer}>
                <CustomTextInput3
                    ref={inputRef}
                    placeholder={translate(placeholder)}
                    placeholderTextColor={colors.Text03}
                    onChangeText={setDescriptionText}
                    multiline={true}
                    externalTextStyle={localStyles.textInputText}
                    externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                    initialTextExtended={descriptionText}
                    styleTheme={TASK_THEME}
                    projectId={projectId}
                    projectIndex={projectIndex >= 0 ? projectIndex : undefined}
                    setMentionsModalActive={setMentionsModalActive}
                    disabledMentions={!projectId}
                    disabledTags={!projectId}
                    disabledEdition={disabled}
                    keepBreakLines={true}
                />
            </View>
            {!!helperText && <Text style={localStyles.helperText}>{translate(helperText)}</Text>}
            {!disabled && (
                <View style={localStyles.buttonsContainer}>
                    <Button
                        title={smallScreen ? null : descriptionText !== savedDescription ? translate('Save') : 'Ok'}
                        type={'primary'}
                        icon={smallScreen ? (descriptionText !== savedDescription ? 'save' : 'x') : null}
                        onPress={updateDescription}
                        accessible={false}
                        shortcutText={'Enter'}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 24,
    },
    header: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    inputContainer: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        marginBottom: 8,
        minHeight: 120,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: colors.Text01,
    },
    helperText: {
        ...styles.caption1,
        color: colors.Text03,
        marginBottom: 8,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
})
