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
        dispatch(
            navigateToSettings({
                selectedNavItem: DV_TAB_SETTINGS_PROFILE,
                settingsScrollToTopToken: Date.now(),
            })
        )
        NavigationService.navigate('SettingsView')
    }

    return (
        <View style={localStyles.emptyInbox}>
            <AllProjectsEmptyInboxText />
            <AllProjectsEmptyInboxTags />
            {showEmptyInboxOverview && (
                <EmptyInboxOverview
                    user={loggedUser}
                    style={localStyles.emptyInboxOverview}
                    onOpenAchievements={openAchievements}
                    celebrateNewDay
                />
            )}
            <AllProjectsEmptyInboxPicture />
        </View>
    )
}

const localStyles = {
    // AT-2262: this block is rendered directly under the All Projects line, i.e.
    // ABOVE the assistant composer / email line / task filters, so the congrats
    // is visible without scrolling. As a middle child it must size to its own
    // content: `flex: 1` would let it stretch into any spare height of the
    // scroll container and push the assistant composer off-screen (and shrink
    // the block when the content is taller than the viewport).
    emptyInbox: {
        marginTop: 12,
        marginBottom: 24,
        alignItems: 'center',
    },
    emptyInboxOverview: {
        width: '100%',
        marginTop: 24,
        marginBottom: 24,
    },
}
