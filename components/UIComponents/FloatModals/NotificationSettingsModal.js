import React, { useState } from 'react'
import Button from '../../UIControls/Button'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import Icon from '../../Icon'
import { useSelector } from 'react-redux'
import Backend from '../../../utils/BackendBridge'
import CloseButton from '../../FollowUp/CloseButton'
import { getIsMessagingSupported, initFCM } from '../../../utils/backends/firestore'
import { translate } from '../../../i18n/TranslationService'
import { setUserReceiveEmails, setUserReceivePushNotifications } from '../../../utils/backends/Users/usersFirestore'

const NotificationSettingsModal = ({ setIsOpen }) => {
    const { uid, receiveEmails, pushNotificationsStatus } = useSelector(state => state.loggedUser)
    const [emailNotifications, setEmailNotifications] = useState(receiveEmails)
    const [pushNotifications, setPushNotifications] = useState(pushNotificationsStatus)
    const isSupported = getIsMessagingSupported()

    const onSave = () => {
        setUserReceiveEmails(uid, emailNotifications)
        if (pushNotifications) {
            initFCM(uid)
        } else setUserReceivePushNotifications(uid, pushNotifications)
        setIsOpen(false)
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={{ paddingHorizontal: 16 }}>
                <View style={{ marginBottom: 24 }}>
                    <Text style={[styles.title7, { color: '#fff' }]}>
                        {translate('How do you want notifications?')}
                    </Text>
                    <Text style={localStyles.subtitle}>{translate('Select the ways Alldone will notify you')}</Text>
                </View>

                <TouchableOpacity
                    onPress={() => setEmailNotifications(!emailNotifications)}
                    style={localStyles.options}
                >
                    <Icon name="notification-mail" size={23} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={[styles.subtitle1, { color: '#fff' }]}>{translate('Email notifications')}</Text>
                    {emailNotifications && <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <Text style={localStyles.info}>
                    <Icon name="info" size={18} color={colors.Text03} style={localStyles.infoIcon} />
                    <Text style={localStyles.subtitle}>{translate('Email notification description')}</Text>
                </Text>

                <TouchableOpacity
                    onPress={() => setPushNotifications(!pushNotifications)}
                    style={[localStyles.options, { marginTop: 16 }]}
                >
                    <Icon name="bell" size={23} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={[styles.subtitle1, { color: '#fff' }]}>{translate('Push notifications')}</Text>
                    {pushNotifications && <Icon name="check" size={18} color="#fff" style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <Text style={localStyles.info}>
                    <Icon name="info" size={18} color={colors.Text03} style={localStyles.infoIcon} />
                    <Text style={localStyles.subtitle}>{translate('Push notification description')}</Text>
                </Text>
                {!isSupported && (
                    <Text style={[localStyles.subtitle, { color: colors.UtilityRed150 }]}>
                        {translate('Push notifications are not supported')}
                    </Text>
                )}
                {Notification.permission === 'denied' && (
                    <Text style={[localStyles.subtitle, { color: colors.UtilityYellow150 }]}>
                        {translate('Push notifications are disabled')}
                    </Text>
                )}
            </View>

            <View style={localStyles.line} />

            <Button title={translate('Save')} type="primary" buttonStyle={{ alignSelf: 'center' }} onPress={onSave} />

            <CloseButton close={() => setIsOpen(false)} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 432,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        paddingVertical: 16,
    },
    subtitle: {
        ...styles.body2,
        color: colors.Text03,
    },
    options: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    info: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    line: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginVertical: 16,
        opacity: 0.6,
    },
    infoIcon: {
        top: 2,
        marginRight: 8,
    },
})

export default NotificationSettingsModal
