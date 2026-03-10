import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import CheckBox from '../../../../CheckBox'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import { setDefaultGmailConnection } from '../../../../../utils/backends/firestore'

export default function ConnectedUserData({ projectId, isConnected, email: connectedEmail }) {
    const email = useSelector(state => state.loggedUser.email)
    const displayName = useSelector(state => state.loggedUser.displayName)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const isDefaultFromStore = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.gmailDefault === true)
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
            await setDefaultGmailConnection(projectId, nextValue)
        } catch (error) {
            console.error('[ConnectGmail] Error updating default Gmail connection:', error)
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
                            <Text style={localStyles.defaultTitle}>{translate('Use as default Gmail account')}</Text>
                            <Text style={localStyles.defaultDescription}>
                                {translate('New assistant email drafts use this Gmail account by default.')}
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
