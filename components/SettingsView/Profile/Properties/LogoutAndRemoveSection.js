import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import Backend from '../../../../utils/BackendBridge'
import SettingsHelper from '../../SettingsHelper'
import RemoveUser from './RemoveUser'

export default function LogoutAndRemoveSection() {
    const loggedUser = useSelector(state => state.loggedUser)

    const logoutUser = () => {
        Backend.logout(SettingsHelper.onLogOut)
    }

    return (
        <View style={localStyles.container}>
            <View>
                <Button
                    icon={'log-out'}
                    title={translate('Logout')}
                    type={'ghost'}
                    onPress={logoutUser}
                    buttonStyle={{ alignSelf: 'flex-end' }}
                />
                <RemoveUser user={loggedUser} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 94,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginBottom: 32,
    },
})
