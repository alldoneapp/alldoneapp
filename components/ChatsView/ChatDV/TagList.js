import React from 'react'
import DetailViewHeaderTags from '../../UIComponents/DetailViewHeaderTags'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_CHAT_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import PrivacyTag from '../../Tags/PrivacyTag'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_CHAT_BOARD } from '../../../utils/TabNavigationConstants'
import DvBotButton from '../../UIControls/DvBotButton'

export default function TagList({ projectId, chat }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const tablet = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile
    return (
        <DetailViewHeaderTags
            privacyTag={
                <PrivacyTag
                    projectId={projectId}
                    object={chat}
                    objectType={FEED_CHAT_OBJECT_TYPE}
                    disabled={!accessGranted}
                    isMobile={isMobile}
                />
            }
            actions={
                <>
                    <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                    <DvBotButton
                        style={{ top: -5 }}
                        navItem={DV_TAB_CHAT_BOARD}
                        projectId={projectId}
                        assistantId={chat.assistantId}
                    />
                    <OpenInNewWindowButton style={{ top: -5 }} />
                </>
            }
        />
    )
}
