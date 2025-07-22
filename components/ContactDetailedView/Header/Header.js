import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import UserTitle from '../../UserDetailedView/Header/UserTitle'
import Indicator from './Indicator'
import BackButton from '../../UserDetailedView/Header/BackButton'
import MyPlatform from '../../MyPlatform'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import TagList from './TagList'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { Dismissible } from 'react-dismissible'
import SharedHelper from '../../../utils/SharedHelper'
import { DV_TAB_CONTACT_CHAT } from '../../../utils/TabNavigationConstants'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'
import { setProjectContactName } from '../../../utils/backends/Contacts/contactsFirestore'

export default function Header({ contact, disabled, isFullscreen, setFullscreen, projectId }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const [inputWidth, setInputWidth] = useState(0)
    const [focused, setFocused] = useState(true)
    const [editContactName, setEditContactName] = useState(false)
    const [contactName, setContactName] = useState(contact.displayName)

    const inputText = useRef(null)
    const mainContainer = useRef(null)
    const buttonsContainer = useRef(null)

    const onFocus = () => {
        setFocused(true)
    }

    const onBlur = () => {
        setFocused(false)
    }

    const updateInputWidth = async () => {
        if (mainContainer.current) {
            const promises = []
            promises.push(MyPlatform.getElementWidth(mainContainer.current))
            promises.push(MyPlatform.getElementWidth(buttonsContainer.current))
            const [containerWidth, buttonsContainerWidth] = await Promise.all(promises)
            setInputWidth(containerWidth - buttonsContainerWidth)
        }
    }

    const toggleEditContactName = () => {
        setEditContactName(state => !state)
    }

    const onChangeText = value => {
        setContactName(value.replaceAll('\n', ''))
    }

    const cancelEditForm = () => {
        setContactName(contact.displayName)
        toggleEditContactName()
    }

    const applyTitleChanges = () => {
        if (contactName.trim()) {
            setProjectContactName(projectId, contact, contact.uid, contactName.trim(), contact.displayName)
        } else {
            setContactName(contact.displayName)
        }
        toggleEditContactName()
    }

    const onInputKeyPress = key => {
        if (key === 'Enter') {
            applyTitleChanges()
        } else if (key === 'Escape') {
            cancelEditForm()
        }
    }

    useEffect(() => {
        if (showGlobalSearchPopup && editContactName) cancelEditForm()
    }, [showGlobalSearchPopup, editContactName])

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const disabledBtn = contact.displayName === contactName || contactName === ''

    return (
        <View style={localStyles.container}>
            <View style={[localStyles.upperHeader, isFullscreen && { paddingBottom: 16 }]}>
                {isMiddleScreen && accessGranted && (
                    <View style={localStyles.backButtonMobile}>
                        <BackButton user={contact} projectIndex={project.index} />
                    </View>
                )}

                {!editContactName ? (
                    <TouchableOpacity
                        style={[localStyles.upperHeader, { flex: 1 }]}
                        onPress={toggleEditContactName}
                        disabled={!accessGranted || disabled}
                    >
                        <View style={[localStyles.upperHeader, { flex: 1 }]}>
                            <View style={{ marginRight: 'auto', flex: 1 }}>
                                <UserTitle contact={contact} project={project} isContact={true} />
                            </View>
                            <View>
                                <Indicator />
                            </View>
                        </View>
                    </TouchableOpacity>
                ) : (
                    <View ref={mainContainer} style={[localStyles.inputContainer]} onLayout={updateInputWidth}>
                        <View
                            style={[
                                localStyles.textInputContainer,
                                focused ? localStyles.inputContainerFocused : localStyles.inputContainerBlurred,
                                { width: inputWidth },
                            ]}
                        >
                            <Dismissible
                                disabled={exitsOpenModals()}
                                click={true}
                                escape={true}
                                onDismiss={cancelEditForm}
                            >
                                <CustomTextInput3
                                    ref={inputText}
                                    numberOfLines={1}
                                    autoFocus={true}
                                    initialTextExtended={contactName}
                                    onKeyPress={onInputKeyPress}
                                    placeholderTextColor={colors.Text03}
                                    containerStyle={[
                                        localStyles.textInput,
                                        !focused ? localStyles.inputTextBlurred : undefined,
                                        { width: inputWidth },
                                    ]}
                                    onFocus={onFocus}
                                    onBlur={onBlur}
                                    onChangeText={onChangeText}
                                    projectId={projectId}
                                    projectIndex={project.index}
                                    placeholder="Write the name of the contact"
                                    singleLine={true}
                                    forceTriggerEnterActionForBreakLines={applyTitleChanges}
                                />
                            </Dismissible>
                        </View>

                        <View ref={buttonsContainer} style={localStyles.buttonsContainer}>
                            <Button
                                type={'secondary'}
                                icon={'x'}
                                buttonStyle={localStyles.secondaryBtn}
                                onPress={cancelEditForm}
                            />
                            <Button type={'primary'} icon={'save'} disabled={disabledBtn} onPress={applyTitleChanges} />
                        </View>
                    </View>
                )}
            </View>

            {!isFullscreen && (
                <View style={localStyles.bottomHeader}>
                    <TagList project={project} contact={contact} />
                </View>
            )}
            {isFullscreen && selectedNavItem === DV_TAB_CONTACT_CHAT && (
                <View style={localStyles.bottomHeader}>
                    <BotLine
                        setFullscreen={setFullscreen}
                        objectId={contact.uid}
                        assistantId={contact.assistantId}
                        projectId={projectId}
                        objectType={'contacts'}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 140,
        flexDirection: 'column',
        justifyContent: 'space-between',
        paddingBottom: 24,
        overflow: 'hidden',
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    bottomHeader: {
        flexDirection: 'row',
        justifyItems: 'flex-end',
    },
    backButtonMobile: {
        left: -16,
    },
    inputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 28,
    },
    textInputContainer: {
        flex: 1,
        height: 40,
        borderWidth: 2,
        borderRadius: 4,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
    },
    inputContainerFocused: {
        borderWidth: 2,
        borderColor: colors.UtilityBlue200,
    },
    inputContainerBlurred: {
        borderWidth: 1,
        height: 42,
        borderColor: colors.Grey400,
    },
    inputTextBlurred: {
        height: 44,
        left: -1,
        color: colors.Text03,
    },
    textInput: {
        paddingHorizontal: 14,
        paddingTop: 0,
        height: 24,
    },
    buttonsContainer: {
        flexDirection: 'row',
    },
    secondaryBtn: {
        marginLeft: 8,
        marginRight: 8,
    },
})
