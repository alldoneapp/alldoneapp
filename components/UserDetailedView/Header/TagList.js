import React from 'react'
import { StyleSheet, View } from 'react-native'
import ProjectTag from '../../Tags/ProjectTag'
import { FEED_USER_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import SharedHelper from '../../../utils/SharedHelper'
import { useSelector } from 'react-redux'
import PrivacyTag from '../../Tags/PrivacyTag'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_USER_CHAT } from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import DvBotButton from '../../UIControls/DvBotButton'

export default function TagList({ project, user }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const tablet = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)
    ContactsHelper.getAndAssignUserPrivacy(project.index, user)
    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile

    const userIsLoggedUser = loggedUser.uid === user.uid
    const loggedUserCanUpdateObject =
        userIsLoggedUser || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id)

    return (
        <View style={localStyles.container}>
            <View style={localStyles.tagList}>
                <View style={{ marginRight: 12 }}>
                    <ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} />
                </View>
                <View style={{ marginRight: 12 }}>
                    <PrivacyTag
                        projectId={project.id}
                        object={user}
                        objectType={FEED_USER_OBJECT_TYPE}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        isMobile={isMobile}
                    />
                </View>
            </View>

            <View style={{ flexDirection: 'row' }}>
                <CopyLinkButton style={{ top: 3, marginRight: 8 }} />
                <DvBotButton
                    style={{ top: 3 }}
                    navItem={DV_TAB_USER_CHAT}
                    projectId={project.id}
                    assistantId={user.assistantId}
                />
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
