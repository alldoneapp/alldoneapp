import React from 'react'
import { StyleSheet, View } from 'react-native'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import ProjectMembersTag from '../../Tags/ProjectMembersTag'
import { size } from 'lodash'
import { useSelector } from 'react-redux'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'

export default function TagList({ project }) {
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const tablet = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMobile = sidebarExpanded ? tablet : mobile

    return (
        <View style={localStyles.container}>
            <View style={localStyles.tagList}>
                <View style={{ marginRight: 12 }}>
                    <ProjectMembersTag amount={size(project.userIds)} isMobile={isMobile} />
                </View>
            </View>

            <View style={{ flexDirection: 'row' }}>
                <CopyLinkButton style={{ top: 3, marginRight: 8 }} />
                <OpenInNewWindowButton style={{ top: 3 }} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    tagList: {
        flex: 1,
        flexGrow: 1,
        flexDirection: 'row',
    },
})
