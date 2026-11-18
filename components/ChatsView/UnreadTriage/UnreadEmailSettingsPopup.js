import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Switch from '../../UIControls/Switch'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import useEscapeKey from '../../../hooks/useEscapeKey'
import { themed } from '../../../Themes/colorMode'
import {
    UNREAD_EMAIL_SETTING_ARCHIVE,
    UNREAD_EMAIL_SETTING_SHOW,
    normalizeUnreadEmailSettings,
    setUnreadEmailSetting,
} from './unreadEmailSettings'

const SETTING_ROWS = [
    { kind: 'newsletter', labelKey: 'Archive newsletters automatically' },
    { kind: 'ads', labelKey: 'Archive ads automatically' },
]

/**
 * Whether newsletters and ads show in the unread list or are archived automatically
 * (users/{uid}.unreadEmailSettings, read by the Gmail labeling sync). Both show by default.
 */
export default function UnreadEmailSettingsPopup({ closePopover }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const storedSettings = useSelector(state => state.loggedUser.unreadEmailSettings)
    const settings = normalizeUnreadEmailSettings(storedSettings)
    const [failedKind, setFailedKind] = useState(null)

    useEscapeKey(closePopover)

    const setArchived = (kind, archived) => {
        setFailedKind(null)
        setUnreadEmailSetting(userId, kind, archived ? UNREAD_EMAIL_SETTING_ARCHIVE : UNREAD_EMAIL_SETTING_SHOW).catch(
            error => {
                console.error('[unread list] Could not save the email setting', error)
                setFailedKind(kind)
            }
        )
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]} testID="unread-email-settings">
            <View style={localStyles.header}>
                <Text style={[styles.title7, localStyles.title]}>{translate('Newsletters and ads')}</Text>
                <Text style={[styles.body2, localStyles.description]}>
                    {translate('UnreadEmailSettingsDescription')}
                </Text>
            </View>
            {SETTING_ROWS.map(({ kind, labelKey }) => (
                <View key={kind} style={localStyles.row}>
                    <Text style={[styles.subtitle1, localStyles.rowText]}>{translate(labelKey)}</Text>
                    <Switch
                        active={settings[kind] === UNREAD_EMAIL_SETTING_ARCHIVE}
                        activeSwitch={() => setArchived(kind, true)}
                        deactiveSwitch={() => setArchived(kind, false)}
                    />
                </View>
            ))}
            {!!failedKind && (
                <Text style={[styles.caption2, localStyles.error]}>
                    {translate('Could not save the setting. Try again')}
                </Text>
            )}
            <TouchableOpacity
                style={localStyles.closeButton}
                onPress={closePopover}
                accessibilityLabel={translate('Close')}
            >
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        boxShadow: themed.PopupShadow,
        elevation: 3,
        padding: 16,
    },
    header: {
        marginBottom: 12,
        paddingRight: 24,
    },
    title: {
        color: '#ffffff',
    },
    description: {
        color: colors.Text03,
        marginTop: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 40,
    },
    rowText: {
        flex: 1,
        color: '#ffffff',
        marginRight: 12,
    },
    error: {
        color: colors.UtilityRed200,
        marginTop: 4,
    },
    closeButton: {
        position: 'absolute',
        top: 12,
        right: 12,
    },
})
