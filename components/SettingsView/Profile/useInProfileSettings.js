import { useSelector } from 'react-redux'

import { DV_TAB_SETTINGS_PROFILE } from '../../../utils/TabNavigationConstants'

export default function useInProfileSettings() {
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const inSettings = selectedNavItem === DV_TAB_SETTINGS_PROFILE
    return inSettings
}
