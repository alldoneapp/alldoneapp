import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { FEED_SKILL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import PrivacyTag from '../../Tags/PrivacyTag'

export default function TagList({ projectId }) {
    const skill = useSelector(state => state.skillInDv)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)

    const isSkillsOwner = !isAnonymous && skill.userId === loggedUserId
    const isMobile = sidebarExpanded ? isMiddleScreen : smallScreenNavigation

    return (
        <View style={localStyles.container}>
            <View style={{ marginLeft: 12 }}>
                <PrivacyTag
                    projectId={projectId}
                    object={skill}
                    objectType={FEED_SKILL_OBJECT_TYPE}
                    disabled={!isSkillsOwner}
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
