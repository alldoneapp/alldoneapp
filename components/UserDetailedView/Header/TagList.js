import React from 'react'
import DetailViewHeaderTags from '../../UIComponents/DetailViewHeaderTags'
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
        <DetailViewHeaderTags
            projectTag={<ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} truncate />}
            privacyTag={
                <PrivacyTag
                    projectId={project.id}
                    object={user}
                    objectType={FEED_USER_OBJECT_TYPE}
                    disabled={!accessGranted || !loggedUserCanUpdateObject}
                    isMobile={isMobile}
                />
            }
            actions={
                <>
                    <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                    {accessGranted && (
                        <DvBotButton
                            style={{ top: -5 }}
                            navItem={DV_TAB_USER_CHAT}
                            projectId={project.id}
                            assistantId={user.assistantId}
                        />
                    )}
                    <OpenInNewWindowButton style={{ top: -5 }} />
                </>
            }
        />
    )
}
