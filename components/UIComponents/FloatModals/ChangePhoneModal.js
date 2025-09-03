import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'
import { validatePhoneNumber, getDisplayPhoneNumber } from '../../../utils/phoneValidation'

export default function ChangePhoneModal({ currentPhone, closePopover, onSaveData, disabled }) {
    const [phone, setPhone] = useState(currentPhone && typeof currentPhone === 'string' ? currentPhone : '')
    const [validationError, setValidationError] = useState('')
    const phoneInputRef = useRef()
    const [width, height] = useWindowSize()

    const onPressSaveButton = () => {
        const validation = validatePhoneNumber(phone)

        if (!validation.isValid) {
            setValidationError(translate(validation.error) || validation.error || 'Invalid phone number')
            return
        }

        if (onSaveData) {
            onSaveData(validation.formatted)
        }
        closePopover()
    }

    const onPhoneChange = newPhone => {
        setPhone(newPhone)
        // Clear error when user starts typing
        if (validationError) {
            setValidationError('')
        }
    }

    const enterKeyAction = () => {
        onPressSaveButton()
    }

    const onPressKey = event => {
        if (event.key === 'Enter') {
            enterKeyAction()
        } else if (event.key === 'Escape') {
            closePopover()
        }
    }

    useEffect(() => {
        setTimeout(() => phoneInputRef.current?.focus(), 1)
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onPressKey)
        return () => {
            document.removeEventListener('keydown', onPressKey)
        }
    })

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 20 }}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>
                        {translate('Phone / WhatsApp') || 'Phone / WhatsApp'}
                    </Text>
                    <Text style={[styles.body2, { color: colors.Text03, marginBottom: 8 }]}>
                        {translate('Add your phone number or WhatsApp') || 'Add your phone number or WhatsApp'}
                    </Text>
                    <Text style={[styles.caption2, { color: colors.Text03 }]}>
                        {translate('Phone format description') ||
                            'Enter your number in any format. It will be automatically formatted with country code.'}
                    </Text>
                </View>
                <View style={localStyles.section}>
                    <Text style={localStyles.phoneLabel}>
                        {translate('Phone / WhatsApp number') || 'Phone / WhatsApp number'}
                    </Text>
                    <CustomTextInput3
                        ref={phoneInputRef}
                        containerStyle={localStyles.phoneInput}
                        initialTextExtended={phone || ''}
                        placeholder={translate('Type the phone number') || 'Type the phone number'}
                        placeholderTextColor={colors.Text03}
                        multiline={false}
                        numberOfLines={1}
                        onChangeText={onPhoneChange}
                        disabledTags={true}
                        singleLine={true}
                        styleTheme={COMMENT_MODAL_THEME}
                        disabledTabKey={true}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                        disabledEdition={disabled}
                        characterLimit={50}
                        autoFocus={true}
                    />
                    {validationError ? <Text style={localStyles.errorText}>{String(validationError)}</Text> : null}
                </View>
                <View style={localStyles.buttonContainer}>
                    <Button
                        type={'primary'}
                        title={translate(disabled ? 'Ok' : 'Save') || (disabled ? 'Ok' : 'Save')}
                        onPress={onPressSaveButton}
                    />
                </View>
                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 16,
    },
    section: {
        flex: 1,
    },
    phoneLabel: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    phoneInput: {
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
    errorText: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
        marginLeft: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
