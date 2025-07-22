import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME, NEW_TOPIC_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import ProjectHelper, { ALL_PROJECTS_INDEX } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'

export default function ChangeContactInfoModal({
    currentRole,
    currentCompany,
    currentDescription,
    closePopover,
    onSaveData,
    projectId,
    disabled,
}) {
    const [role, setRole] = useState(currentRole ? currentRole : '')
    const [company, setCompany] = useState(currentCompany ? currentCompany : '')
    const [description, setDescription] = useState(currentDescription ? currentDescription : '')
    const [mentionsModalActive, setMentionsModalActive] = useState(false)

    const roleInputRef = useRef()
    const companyInputRef = useRef()
    const descriptionInputRef = useRef()

    const [width, height] = useWindowSize()

    const onPressSaveButton = () => {
        if (onSaveData) {
            onSaveData({
                role: role.trim(),
                company: company.trim(),
                description: description.trim(),
            })
        }
        closePopover()
    }

    const enterKeyAction = () => {
        if (!mentionsModalActive) onPressSaveButton()
    }

    const onPressKey = event => {
        if (event.key === 'Enter') {
            enterKeyAction()
        } else if (event.key === 'Escape') {
            closePopover()
        } else if (event.key === 'Tab') {
            event.preventDefault()
            event.stopPropagation()
            if (roleInputRef.current.isFocused()) {
                companyInputRef.current.focus()
            } else if (companyInputRef.current.isFocused()) {
                descriptionInputRef.current.focus()
            } else if (descriptionInputRef.current.isFocused()) {
                roleInputRef.current.focus()
            }
        }
    }

    useEffect(() => {
        setTimeout(() => roleInputRef.current?.focus(), 1)
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onPressKey)
        return () => {
            document.removeEventListener('keydown', onPressKey)
        }
    })

    const projectIndex = projectId ? ProjectHelper.getProjectIndexById(projectId) : ALL_PROJECTS_INDEX

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 20 }}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Contact info')}</Text>
                    <Text style={[styles.body2, { color: colors.Text03 }]}>
                        {translate('Please fill out the following info')}
                    </Text>
                </View>
                <View style={localStyles.section}>
                    <Text style={localStyles.roleLabel}>{translate('What do you do?')}</Text>
                    <CustomTextInput3
                        ref={roleInputRef}
                        containerStyle={localStyles.roleInput}
                        initialTextExtended={role}
                        placeholder={translate('Type role title')}
                        placeholderTextColor={colors.Text03}
                        multiline={false}
                        numberOfLines={1}
                        onChangeText={setRole}
                        disabledTags={true}
                        singleLine={true}
                        styleTheme={COMMENT_MODAL_THEME}
                        disabledTabKey={true}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                        disabledEdition={disabled}
                        characterLimit={50}
                        autoFocus={true}
                    />
                </View>
                <View style={[localStyles.section, { marginTop: 12 }]}>
                    <Text style={localStyles.roleLabel}>{translate('Company')}</Text>
                    <CustomTextInput3
                        ref={companyInputRef}
                        containerStyle={localStyles.roleInput}
                        initialTextExtended={company}
                        placeholder={translate('Type company name')}
                        placeholderTextColor={colors.Text03}
                        multiline={false}
                        numberOfLines={1}
                        onChangeText={setCompany}
                        disabledTags={true}
                        singleLine={true}
                        styleTheme={COMMENT_MODAL_THEME}
                        disabledTabKey={true}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                        disabledEdition={disabled}
                        characterLimit={50}
                    />
                </View>
                <View style={[localStyles.section, { marginTop: 12 }]}>
                    <Text style={localStyles.roleLabel}>{translate('Description')}</Text>
                    <CustomTextInput3
                        ref={descriptionInputRef}
                        containerStyle={[localStyles.roleInput, localStyles.textarea]}
                        initialTextExtended={description}
                        placeholder={translate('Short description')}
                        placeholderTextColor={colors.Text03}
                        multiline={true}
                        numberOfLines={1}
                        onChangeText={setDescription}
                        styleTheme={NEW_TOPIC_MODAL_THEME}
                        projectId={projectId}
                        projectIndex={projectIndex >= 0 && projectIndex}
                        setMentionsModalActive={setMentionsModalActive}
                        disabledMentions={projectId == null}
                        disabledTabKey={true}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                        disabledEdition={disabled}
                        characterLimit={300}
                    />
                </View>
                <View style={localStyles.buttonContainer}>
                    <Button type={'primary'} title={translate(disabled ? 'Ok' : 'Save')} onPress={onPressSaveButton} />
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
