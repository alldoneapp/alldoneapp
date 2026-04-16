import React from 'react'
import { StyleSheet, View } from 'react-native'
import ProjectTag from '../../Tags/ProjectTag'
import { FEED_CONTACT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import PrivacyTag from '../../Tags/PrivacyTag'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_CONTACT_CHAT } from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import DvBotButton from '../../UIControls/DvBotButton'
import DvSearchButton from '../../UIControls/DvSearchButton'

export default function TagList({ project, contact }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const tablet = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)
    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile
    const useCompactLayout = mobile || tablet

    const loggedUserIsCreator = loggedUser.uid === contact.recorderUserId
    const loggedUserCanUpdateObject =
        loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id)

    return (
        <View style={[localStyles.container, useCompactLayout && localStyles.containerCompact]}>
            <View style={[localStyles.tagList, useCompactLayout && localStyles.tagListCompact]}>
                <View style={{ marginRight: 12 }}>
                    <ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} />
                </View>
                <View style={{ marginRight: 12 }}>
                    <PrivacyTag
                        projectId={project.id}
                        object={contact}
                        objectType={FEED_CONTACT_OBJECT_TYPE}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        isMobile={isMobile}
                    />
                </View>
            </View>

            <View style={[localStyles.actions, useCompactLayout && localStyles.actionsCompact]}>
                <CopyLinkButton style={{ top: 3, marginRight: 8 }} />
                <DvSearchButton style={{ top: 3 }} />
                <DvBotButton
                    style={{ top: 3 }}
                    navItem={DV_TAB_CONTACT_CHAT}
                    projectId={project.id}
                    assistantId={contact.assistantId}
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
        minWidth: 0,
        alignItems: 'flex-start',
    },
    containerCompact: {
        flexWrap: 'wrap',
    },
    tagList: {
        flex: 1,
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'row',
        minWidth: 0,
    },
    tagListCompact: {
        flexWrap: 'wrap',
    },
    actions: {
        flexDirection: 'row',
        flexShrink: 0,
        marginLeft: 8,
    },
    actionsCompact: {
        width: '100%',
        marginLeft: 0,
        marginTop: 8,
        justifyContent: 'flex-end',
    },
})
