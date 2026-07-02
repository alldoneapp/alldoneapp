import React from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInboxTags from './AllProjectsEmptyInboxTags'
import AllProjectsEmptyInboxText from './AllProjectsEmptyInboxText'
import AllProjectsEmptyInboxPicture from './AllProjectsEmptyInboxPicture'
import { EmptyInboxOverview } from '../../SettingsView/Profile/Achievements/AchievementsArea'
import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../../utils/TabNavigationConstants'
import NavigationService from '../../../utils/NavigationService'

export default function AllProjectsEmptyInbox({ showEmptyInboxOverview = false }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)

    const openAchievements = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
        NavigationService.navigate('SettingsView')
    }

    return (
        <View style={localStyles.emptyInbox}>
            <AllProjectsEmptyInboxText />
            <AllProjectsEmptyInboxTags />
            <AllProjectsEmptyInboxPicture />
            {showEmptyInboxOverview && (
                <EmptyInboxOverview
                    user={loggedUser}
                    style={localStyles.emptyInboxOverview}
                    onOpenAchievements={openAchievements}
                />
            )}
        </View>
    )
}

const localStyles = {
    emptyInbox: {
        flex: 1,
        marginTop: 12,
        alignItems: 'center',
    },
    emptyInboxOverview: {
        width: '100%',
        marginTop: 24,
        marginBottom: 24,
    },
}
