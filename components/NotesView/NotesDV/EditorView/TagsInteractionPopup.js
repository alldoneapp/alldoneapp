import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import MyPlatform from '../../../MyPlatform'

import Icon from '../../../Icon'
import { colors } from '../../../styles/global'
import { hideFloatPopup, setIsQuillTagEditorOpen, showFloatPopup } from '../../../../redux/actions'
import { COMMENT_MODAL_THEME, TAG_INTERACTION_CLASS } from '../../../Feeds/CommentsTextInput/textInputHelper'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { MENTION_SPACE_CODE } from '../../../Feeds/Utils/HelperFunctions'
import { removeModal, storeModal, TAGS_INTERACTION_MODAL_ID } from '../../../ModalsManager/modalsManager'

const TagsInteractionPopup = ({
    ico,
    inputTextColor,
    initialValue,
    performAction,
    closeModal,
    updateValue,
    textIsValid,
    inMentionsEditionTag,
    projectId,
    selectItemToMention,
}) => {
    const mentionModalNewFormOpen = useSelector(state => state.mentionModalNewFormOpen)
    const textInputRef = useRef(null)
    const currentValueRef = useRef(initialValue)
    const dispatch = useDispatch()
    const [renderTrigger, setRenderTrigger] = useState(true)
    const [disabled, setDisabled] = useState(false)

    const getTextAttributes = trimmedText => {
        const isModified = initialValue !== trimmedText && trimmedText !== ''
        const isValidText = textIsValid ? textIsValid(trimmedText) : true
        return { isModified, isValidText }
    }

    const getCloseIco = () => {
        const trimmedText = currentValueRef.current.trim()
        const { isModified, isValidText } = getTextAttributes(trimmedText)
        return isModified && isValidText ? 'save' : 'x'
    }

    const closeOrSave = () => {
        const trimmedText = currentValueRef.current.trim()
        const { isModified, isValidText } = getTextAttributes(trimmedText)

        let cleanValue
        if (inMentionsEditionTag) {
            cleanValue = currentValueRef.current.replace(/\s+/g, MENTION_SPACE_CODE)
        } else {
            cleanValue = currentValueRef.current.replace(/\s+/g, '')
        }
        isModified && isValidText ? updateValue(cleanValue) : closeModal(textIsValid && !textIsValid(initialValue))
        if (!MyPlatform.isDesktop) {
            setTimeout(() => {
                dispatch([hideFloatPopup(), setIsQuillTagEditorOpen(false)])
                removeModal(TAGS_INTERACTION_MODAL_ID)
            }, 300)
        }
    }

    const onChangeValue = value => {
        currentValueRef.current = value
        setRenderTrigger(!renderTrigger)
    }

    const enterKeyAction = () => {
        if (!mentionModalNewFormOpen) closeOrSave()
    }

    const onKeyDown = event => {
        const { key } = event

        if (key === 'Enter') {
            enterKeyAction()
        }

        if (key === 'Escape') {
            closeModal(textIsValid && !textIsValid(initialValue))
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    useEffect(() => {
        textInputRef.current.focus()
        dispatch([showFloatPopup(), setIsQuillTagEditorOpen(true)])

        const wrapper = document.getElementById(TAGS_INTERACTION_MODAL_ID)?.parentElement
        wrapper?.classList?.add(TAG_INTERACTION_CLASS)

        return () => {
            dispatch([hideFloatPopup(), setIsQuillTagEditorOpen(false)])
        }
    }, [])

    useEffect(() => {
        const trimmedText = currentValueRef.current.trim()
        const { isValidText } = getTextAttributes(trimmedText)
        setDisabled(!isValidText)
    }, [currentValueRef.current])

    useEffect(() => {
        storeModal(TAGS_INTERACTION_MODAL_ID)
        return () => {
            removeModal(TAGS_INTERACTION_MODAL_ID)
        }
    }, [])

    return (
        <View style={localStyles.container} nativeID={TAGS_INTERACTION_MODAL_ID}>
            <Icon name={ico} size={24} color={'#FFFFFF'} />
            <View style={localStyles.inputContainer}>
                {inMentionsEditionTag ? (
                    <CustomTextInput3
                        ref={textInputRef}
                        initialTextExtended={currentValueRef.current}
                        containerStyle={[localStyles.input, localStyles.mentionInput]}
                        onChangeText={onChangeValue}
                        autoFocus={true}
                        singleLine={true}
                        inMentionsEditionTag={true}
                        styleTheme={COMMENT_MODAL_THEME}
                        placeholder=""
                        setMentionsModalActive={() => {}}
                        projectId={projectId}
                        selectUserToMentionEditTag={selectItemToMention}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                ) : (
                    <TextInput
                        ref={textInputRef}
                        value={currentValueRef.current}
                        style={[localStyles.input, { color: inputTextColor }]}
                        onChangeText={onChangeValue}
                        autoFocus={true}
                    />
                )}
            </View>
            <View style={localStyles.buttonsContainer}>
                <TouchableOpacity
                    onPress={() => performAction(currentValueRef.current.trim())}
                    disabled={disabled}
                    style={[localStyles.action, disabled && { opacity: 0.5 }]}
                >
                    <Icon name="external-link" size={24} color={colors.Text01} />
                </TouchableOpacity>
                <TouchableOpacity style={localStyles.close} onPress={closeOrSave}>
                    <Icon name={getCloseIco()} size={24} color={'#FFFFFF'} />
                </TouchableOpacity>
            </View>
        </View>
    )
}
export default TagsInteractionPopup

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        width: 448,
        height: 56,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 8,
        backgroundColor: colors.Secondary400,
        alignItems: 'center',
        borderRadius: 4,
    },
    buttonsContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: 86,
    },
    action: {
        backgroundColor: colors.SecondaryButton,
        width: 40,
        height: 40,
        padding: 10,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    close: {
        backgroundColor: colors.Primary300,
        width: 40,
        height: 40,
        padding: 10,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputContainer: {
        marginHorizontal: 8,
        flex: 1,
    },
    input: {
        borderRadius: 4,
        borderColor: colors.Gray400,
        borderWidth: 1,
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        paddingLeft: 16,
        paddingVertical: 8,
    },
    mentionInput: {
        paddingVertical: 1,
    },
})
