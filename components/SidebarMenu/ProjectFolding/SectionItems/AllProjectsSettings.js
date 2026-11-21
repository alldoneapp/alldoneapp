import React from 'react'
import { useDispatch } from 'react-redux'

import store from '../../../../redux/store'
import { hideWebSideBar, navigateToSettings } from '../../../../redux/actions'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_SETTINGS_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'
import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'

/**
 * AT-3121: the general settings as the last row under All projects in the "Anna on top" sidebar,
 * where a project has its own settings. It opens what the sidebar's Settings item opens
 * (SettingsItem), which that sidebar then leaves out further down.
 */
export default function AllProjectsSettings({ projectColor, selected }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        dismissAllPopups(true, true, true)
        const actions = [navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_CUSTOMIZATIONS })]
        if (store.getState().smallScreenNavigation) actions.push(hideWebSideBar())
        dispatch(actions)
        NavigationService.navigate('SettingsView')
    }

    return (
        <SectionItemLayoutHeader
            icon={'settings'}
            text={translate('Settings')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
