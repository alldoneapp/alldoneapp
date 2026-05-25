import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { navigateToSettings } from '../../../../redux/actions'
import NavigationService from '../../../../utils/NavigationService'
import { translate } from '../../../../i18n/TranslationService'
import { DV_TAB_SETTINGS_PROFILE } from '../../../../utils/TabNavigationConstants'

export default function ButtonsArea({ closeModal }) {
    const dispatch = useDispatch()
    const automaticSkillPointDistributionEnabled = useSelector(
        state => state.loggedUser.automaticSkillPointDistributionEnabled !== false
    )

    const navigateToProfile = () => {
        NavigationService.navigate('SettingsView')
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
        closeModal()
    }

    const secondaryTitle = automaticSkillPointDistributionEnabled ? 'Manually check skills' : 'No thanks'
    const primaryTitle = automaticSkillPointDistributionEnabled ? 'Auto-level up skills' : 'Level up skills'
    const secondaryAction = automaticSkillPointDistributionEnabled ? navigateToProfile : closeModal
    const primaryAction = automaticSkillPointDistributionEnabled ? closeModal : navigateToProfile

    return (
        <View style={localStyles.buttonsContainer}>
            <Button
                title={translate(secondaryTitle)}
                iconSize={22}
                buttonStyle={localStyles.button}
                onPress={secondaryAction}
                type={'secondary'}
            />
            <Button title={translate(primaryTitle)} iconSize={22} onPress={primaryAction} />
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
