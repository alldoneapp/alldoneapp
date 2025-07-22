import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'
import MyPlatform from '../../../../MyPlatform'

import Icon from '../../../../Icon'
import { colors } from '../../../../styles/global'
import { hideFloatPopup, setIsQuillTagEditorOpen, showFloatPopup } from '../../../../../redux/actions'
import { TAG_INTERACTION_CLASS } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import { removeModal, storeModal, TAGS_INTERACTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import ColorDot from './ColorDot'
import { removeColor } from '../../../../../functions/Utils/hashtagUtils'

export const COLOR_KEY_0 = '0'
export const COLOR_KEY_1 = '1'
export const COLOR_KEY_2 = '2'
export const COLOR_KEY_3 = '3'
export const COLOR_KEY_4 = '4'

export const HASHTAG_COLOR_MAPPING = {
    [COLOR_KEY_0]: {
        tagText: colors.UtilityRed300,
        tagBack: colors.UtilityRed112,
        editText: colors.UtilityRed150,
        editDot: colors.UtilityRed200,
    },
    [COLOR_KEY_1]: {
        tagText: colors.UtilityYellow300,
        tagBack: colors.UtilityYellow112,
        editText: colors.UtilityYellow150,
        editDot: colors.UtilityYellow200,
    },
    [COLOR_KEY_2]: {
        tagText: colors.UtilityGreen300,
        tagBack: colors.UtilityGreen112,
        editText: colors.UtilityGreen150,
        editDot: colors.UtilityGreen200,
    },
    [COLOR_KEY_3]: {
        tagText: colors.UtilityBlue300,
        tagBack: colors.UtilityBlue112,
        editText: colors.UtilityBlue150,
        editDot: colors.UtilityBlue200,
    },
    [COLOR_KEY_4]: {
        tagText: colors.UtilityViolet300,
        tagBack: colors.UtilityViolet112,
        editText: colors.UtilityViolet150,
        editDot: colors.UtilityViolet200,
    },
}

const HashtagsInteractionPopup = ({ text, performAction, closeModal, updateValue, initialColorKey }) => {
    const dispatch = useDispatch()
    const [renderTrigger, setRenderTrigger] = useState(true)
    const [colorKey, setColorKey] = useState(initialColorKey)
    const textInputRef = useRef(null)
    const currentValueRef = useRef(removeColor(text))

    const isModified = trimmedText => {
        return (removeColor(text) !== trimmedText && trimmedText !== '') || initialColorKey !== colorKey
    }

    const getCloseIco = () => {
        const trimmedText = currentValueRef.current.trim()
        return isModified(trimmedText) ? 'save' : 'x'
    }

    const closeOrSave = () => {
        const trimmedText = currentValueRef.current.trim()

        let cleanValue = currentValueRef.current.replace(/\s+/g, '')
        isModified(trimmedText) ? updateValue(cleanValue, colorKey) : closeModal()
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

    const onKeyDown = event => {
        const { key } = event

        if (key === 'Enter') {
            closeOrSave()
        }

        if (key === 'Escape') {
            closeModal()
        }
    }

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
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    useEffect(() => {
        storeModal(TAGS_INTERACTION_MODAL_ID)
        return () => {
            removeModal(TAGS_INTERACTION_MODAL_ID)
        }
    }, [])

    return (
        <View style={localStyles.container} nativeID={TAGS_INTERACTION_MODAL_ID}>
            <View style={localStyles.inputParent}>
                <Icon name={'hash'} size={24} color={'#FFFFFF'} />
                <View style={localStyles.inputContainer}>
                    <TextInput
                        ref={textInputRef}
                        value={currentValueRef.current}
                        style={[localStyles.input, { color: HASHTAG_COLOR_MAPPING[colorKey].editText }]}
                        onChangeText={onChangeValue}
                        autoFocus={true}
                    />
                </View>
                <View style={localStyles.buttonsContainer}>
                    <TouchableOpacity
                        onPress={() => performAction(currentValueRef.current.trim())}
                        style={localStyles.action}
                    >
                        <Icon name={'external-link'} size={24} color={colors.Text01} />
                    </TouchableOpacity>
                    <TouchableOpacity style={localStyles.close} onPress={closeOrSave}>
                        <Icon name={getCloseIco()} size={24} color={'#FFFFFF'} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={localStyles.colorParent}>
                {Object.keys(HASHTAG_COLOR_MAPPING).map(key => (
                    <ColorDot key={key} colorKey={key} onPress={setColorKey} selected={key === colorKey} />
                ))}
            </View>
        </View>
    )
}
export default HashtagsInteractionPopup

const localStyles = StyleSheet.create({
    container: {
        width: 448,
        backgroundColor: colors.Secondary400,
        alignItems: 'center',
        borderRadius: 4,
    },
    inputParent: {
        flexDirection: 'row',
        width: 448,
        height: 56,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 8,
        alignItems: 'center',
    },
    colorParent: {
        flexDirection: 'row',
        width: 448,
        height: 48,
        paddingBottom: 8,
        paddingLeft: 44,
        paddingRight: 104,
        alignItems: 'center',
        justifyContent: 'space-between',
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
})
