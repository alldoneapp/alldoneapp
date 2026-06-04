import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { setUserAssistantEmailEnabled } from '../../../../utils/backends/Users/usersFirestore'

const ANNA_EMAIL_ADDRESS = 'anna@alldoneapp.com'

export default function AssistantEmail({ userId, assistantEmailEnabled }) {
    const mobileNav = useSelector(state => state.smallScreenNavigation)

    const toggle = () => {
        setUserAssistantEmailEnabled(userId, !assistantEmailEnabled)
    }

    return (
        <View style={localStyles.wrapper}>
            <TouchableOpacity onPress={toggle} style={localStyles.settingRow}>
                <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                    <Icon name={'notification-mail'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                    {mobileNav ? (
                        <Text style={[styles.body1]} numberOfLines={1}>
                            Anna email
                        </Text>
                    ) : (
                        <View style={localStyles.titleBlock}>
                            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>Anna email</Text>
                            <Text style={[styles.caption1, { color: colors.Text03 }]}>{ANNA_EMAIL_ADDRESS}</Text>
                        </View>
                    )}
                </View>
                <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                    {!mobileNav && (
                        <Text style={[styles.body1, { marginRight: 8 }]}>
                            {assistantEmailEnabled ? 'Enabled' : 'Disabled'}
                        </Text>
                    )}
                    {assistantEmailEnabled && <Icon name="check" size={20} color={colors.Primary100} />}
                </View>
            </TouchableOpacity>
            <Text style={localStyles.infoText}>
                Send from your Google login email and/or any connected Gmail account. Anna replies to the sender and all
                original To/CC recipients. For security reasons, Anna can only find free Calendar times without seeing
                event details, create tasks, create Calendar events, create or update notes, update heartbeat settings,
                create Gmail drafts, and use approved external tools. Every interaction appears in the daily email
                thread.
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    wrapper: {
        marginTop: 8,
        minWidth: 0,
        width: '100%',
    },
    settingRow: {
        minHeight: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
        minWidth: 0,
        width: '100%',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
        minWidth: 0,
        flexShrink: 1,
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
    titleBlock: {
        minWidth: 0,
        flexShrink: 1,
    },
    infoText: {
        ...styles.caption1,
        color: colors.Text03,
        marginHorizontal: 8,
        marginTop: 4,
        minWidth: 0,
        width: '100%',
        flexShrink: 1,
    },
})
