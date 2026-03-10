import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import CheckBox from '../../../../CheckBox'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import { setDefaultCalendarConnection } from '../../../../../utils/backends/firestore'

export default function ConnectedUserData({ projectId, isConnected }) {
    const email = useSelector(state => state.loggedUser.email)
    const displayName = useSelector(state => state.loggedUser.displayName)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const connectedEmail = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendarEmail)
    const isDefaultFromStore =
        useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendarDefault === true) || false
    const [isDefault, setIsDefault] = useState(isDefaultFromStore)
    const [savingDefault, setSavingDefault] = useState(false)

    useEffect(() => {
        setIsDefault(isDefaultFromStore)
    }, [isDefaultFromStore])

    const onToggleDefault = async () => {
        if (savingDefault || !projectId) return

        const nextValue = !isDefault
        setIsDefault(nextValue)
        setSavingDefault(true)

        try {
            await setDefaultCalendarConnection(projectId, nextValue)
        } catch (error) {
            console.error('[ConnectCalendar] Error updating default Calendar connection:', error)
            setIsDefault(isDefaultFromStore)
        } finally {
            setSavingDefault(false)
        }
    }

    return (
        <View style={localStyles.container}>
            <Image source={{ uri: photoURL }} style={localStyles.avatar} />
            <View style={localStyles.content}>
                <Text style={localStyles.username}>{displayName}</Text>
                <Text style={localStyles.info}>
                    {translate(`${isConnected ? 'Connected' : 'Connect'} to Email`, {
                        email: connectedEmail || email,
                    })}
                </Text>
                {isConnected && (
                    <TouchableOpacity style={localStyles.defaultRow} onPress={onToggleDefault} disabled={savingDefault}>
                        <CheckBox checked={isDefault} externalContainerStyle={localStyles.defaultCheckbox} />
                        <View style={localStyles.defaultCopy}>
                            <Text style={localStyles.defaultTitle}>{translate('Use as default Calendar account')}</Text>
                            <Text style={localStyles.defaultDescription}>
                                {translate('New assistant calendar events use this Calendar account by default.')}
                            </Text>
                        </View>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginBottom: 20,
    },
    content: {
        flexDirection: 'column',
        flex: 1,
    },
    username: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    info: {
        ...styles.body2,
        color: colors.Text03,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 100,
        marginRight: 8,
    },
    defaultRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 12,
    },
    defaultCheckbox: {
        marginTop: 2,
    },
    defaultCopy: {
        flex: 1,
        marginLeft: 10,
    },
    defaultTitle: {
        ...styles.subtitle2,
        color: '#ffffff',
    },
    defaultDescription: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 2,
    },
})
