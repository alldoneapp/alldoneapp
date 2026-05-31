import React from 'react'
import { useSelector } from 'react-redux'
import { Image, StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function ConnectGitLabButton({ disabled, connected, onPress }) {
    const photoURL = useSelector(state => state.loggedUser.photoURL)

    return (
        <View style={localStyles.propertyRow}>
            <View style={{ justifyContent: 'flex-start', flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Icon name={'gitlab'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Connect GitLab')}</Text>
            </View>
            <View style={{ justifyContent: 'flex-end' }}>
                <Button
                    icon={connected ? null : 'link'}
                    customIcon={connected ? <Image source={{ uri: photoURL }} style={localStyles.avatar} /> : null}
                    title={translate(connected ? 'Connected' : 'Connect')}
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
