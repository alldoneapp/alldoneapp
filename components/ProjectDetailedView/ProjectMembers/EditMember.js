import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import Button from '../../UIControls/Button'
import Icon from '../../Icon'
import store from '../../../redux/store'
import styles, { colors } from '../../styles/global'
import Backend from '../../../utils/BackendBridge'
import HelperFunctions from '../../../utils/HelperFunctions'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

const EditMember = ({ projectId, onCancelAction, style }) => {
    const [email, setEmail] = useState('')
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }

    const inputTask = useRef()

    useEffect(() => {
        if (showGlobalSearchPopup) {
            onCancelAction()
        }
    }, [showGlobalSearchPopup])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const enterKeyAction = () => {
        if (email.trim().length > 0) {
            addProjectMember()
        }
    }

    const onKeyDown = ({ key }) => {
        if (key === 'Enter') {
            enterKeyAction()
        } else if (key === 'Escape') {
            onCancelAction()
        }
    }

    const addProjectMember = () => {
        const inviterUserId = store.getState().loggedUser.uid

        if (HelperFunctions.isValidEmail(email)) {
            Backend.inviteUserToProject(email, projectId, inviterUserId)
            onCancelAction()
            Keyboard.dismiss()
        }
    }

    return (
        <View style={[localStyles.container, mobile ? localStyles.containerUnderBreakpoint : undefined, style]}>
            <View style={[localStyles.inputContainer]}>
                <View style={[localStyles.icon, mobile ? localStyles.iconMobile : undefined]}>
                    <Icon name={'plus-square'} size={24} color={colors.Primary100} />
                </View>

                <CustomTextInput3
                    ref={inputTask}
                    placeholder={translate('Type an email to send invitation')}
                    containerStyle={[localStyles.input, mobile ? localStyles.inputUnderBreakpoint : undefined]}
                    autoFocus={true}
                    multiline={false}
                    numberOfLines={1}
                    onChangeText={text => setEmail(text)}
                    placeholderTextColor={colors.Text03}
                    disabledTags={true}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                />
            </View>
            <View style={localStyles.buttonContainer}>
                <View style={[localStyles.buttonSection]}>
                    <View style={!mobile && { marginRight: 32 }} />
                </View>

                <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                    {!smallScreen && (
                        <Button
                            title={translate('Cancel')}
                            type={'secondary'}
                            buttonStyle={buttonItemStyle}
                            onPress={onCancelAction}
                            shortcutText={'Esc'}
                        />
                    )}

                    <Button
                        title={smallScreen ? null : translate('Invite')}
                        type={'primary'}
                        icon={smallScreen ? 'plus' : null}
                        onPress={addProjectMember}
                        disabled={email.length === 0}
                        shortcutText={'Enter'}
                    />
                </View>
            </View>
        </View>
    )
}

export default EditMember

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 8,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        minHeight: 56,
        flexDirection: 'row',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 23,
        top: 15,
    },
    iconMobile: {
        left: 15,
    },
    input: {
        ...styles.body1,
        paddingTop: 11,
        paddingBottom: 11,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        paddingLeft: 67,
        paddingRight: 16,
        //  textAlignVertical: 'top',
    },
    inputUnderBreakpoint: {
        paddingLeft: 59,
        paddingRight: 8,
    },
})
