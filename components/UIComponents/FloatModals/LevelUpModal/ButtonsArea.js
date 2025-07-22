import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import Button from '../../../UIControls/Button'
import { navigateToSettings } from '../../../../redux/actions'
import NavigationService from '../../../../utils/NavigationService'
import { translate } from '../../../../i18n/TranslationService'
import { DV_TAB_SETTINGS_PROFILE } from '../../../../utils/TabNavigationConstants'

export default function ButtonsArea({ closeModal }) {
    const dispatch = useDispatch()

    const navigateToProfile = () => {
        NavigationService.navigate('SettingsView')
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
        closeModal()
    }

    return (
        <View style={localStyles.buttonsContainer}>
            <Button
                title={translate('No thanks')}
                iconSize={22}
                buttonStyle={localStyles.button}
                onPress={closeModal}
                type={'secondary'}
            />
            <Button title={translate('Level up skills')} iconSize={22} onPress={navigateToProfile} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    button: {
        marginRight: 16,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
