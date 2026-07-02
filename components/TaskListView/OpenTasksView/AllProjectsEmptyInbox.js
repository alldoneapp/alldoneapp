import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import AllProjectsEmptyInboxTags from './AllProjectsEmptyInboxTags'
import AllProjectsEmptyInboxText from './AllProjectsEmptyInboxText'
import AllProjectsEmptyInboxPicture from './AllProjectsEmptyInboxPicture'
import { EmptyInboxOverview } from '../../SettingsView/Profile/Achievements/AchievementsArea'

export default function AllProjectsEmptyInbox({ showEmptyInboxOverview = false }) {
    const loggedUser = useSelector(state => state.loggedUser)

    return (
        <View style={localStyles.emptyInbox}>
            <AllProjectsEmptyInboxText />
            <AllProjectsEmptyInboxTags />
            <AllProjectsEmptyInboxPicture />
            {showEmptyInboxOverview && <EmptyInboxOverview user={loggedUser} style={localStyles.emptyInboxOverview} />}
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
        marginTop: 16,
        marginBottom: 24,
    },
}
