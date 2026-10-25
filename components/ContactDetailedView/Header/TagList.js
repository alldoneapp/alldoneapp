import React from 'react'
import DetailViewHeaderTags from '../../UIComponents/DetailViewHeaderTags'
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

    const loggedUserIsCreator = loggedUser.uid === contact.recorderUserId
    const loggedUserCanUpdateObject =
        loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id)

    return (
        <DetailViewHeaderTags
            projectTag={<ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} truncate />}
            privacyTag={
                <PrivacyTag
                    projectId={project.id}
                    object={contact}
                    objectType={FEED_CONTACT_OBJECT_TYPE}
                    disabled={!accessGranted || !loggedUserCanUpdateObject}
                    isMobile={isMobile}
                />
            }
            actions={
                <>
                    <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                    {accessGranted && (
                        <>
                            <DvSearchButton style={{ top: -5 }} />
                            <DvBotButton
                                style={{ top: -5 }}
                                navItem={DV_TAB_CONTACT_CHAT}
                                projectId={project.id}
                                assistantId={contact.assistantId}
                            />
                        </>
                    )}
                    <OpenInNewWindowButton style={{ top: -5 }} />
                </>
            }
        />
    )
}
