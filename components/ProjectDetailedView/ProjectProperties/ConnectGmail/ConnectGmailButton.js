import React from 'react'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { Image, StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function ConnectGmailButton({ projectId, disabled, isSignedIn, onPress }) {
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.gmail)

    return (
        <View style={localStyles.propertyRow}>
            <View style={{ justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Icon name={'gmail'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Connect Gmail')}</Text>
            </View>
            <View style={{ justifyContent: 'flex-end' }}>
                <Button
                    icon={isConnected && isSignedIn ? null : 'link'}
                    customIcon={
                        isConnected && isSignedIn ? (
                            <Image source={{ uri: photoURL }} style={localStyles.avatar} />
                        ) : null
                    }
                    title={translate(isConnected && isSignedIn ? 'Connected' : 'Connect')}
                    type={'ghost'}
                    onPress={onPress}
                    disabled={disabled}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
