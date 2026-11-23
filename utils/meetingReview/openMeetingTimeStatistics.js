import store from '../../redux/store'
import { navigateToSettings } from '../../redux/actions'
import NavigationService from '../NavigationService'
import { DV_TAB_SETTINGS_MEETING_TIME } from '../TabNavigationConstants'

/** AT-3137 — opens Settings → Meeting time (the statistics), like the top bar opens Statistics. */
export const openMeetingTimeStatistics = () => {
    store.dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_MEETING_TIME }))
    NavigationService.navigate('SettingsView')
}
