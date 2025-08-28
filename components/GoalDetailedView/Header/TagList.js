import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import DateTag from './DateTag'
import { FEED_GOAL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import PrivacyTag from '../../Tags/PrivacyTag'

export default function TagList({
    projectId,
    completionMilestoneDate,
    goal,
    accessGranted,
    loggedUserCanUpdateObject,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)

    const isMobile = sidebarExpanded ? isMiddleScreen : smallScreenNavigation

    return (
        <View style={localStyles.container}>
            <DateTag completionMilestoneDate={completionMilestoneDate} />
            <View style={{ marginLeft: 12 }}>
                <PrivacyTag
                    projectId={projectId}
                    object={goal}
                    objectType={FEED_GOAL_OBJECT_TYPE}
                    disabled={!accessGranted || !loggedUserCanUpdateObject}
                    isMobile={isMobile}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
})
