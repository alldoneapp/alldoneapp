import React from 'react'
import DetailViewHeaderTags from '../../UIComponents/DetailViewHeaderTags'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_NOTE_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import ProjectTag from '../../Tags/ProjectTag'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import PrivacyTag from '../../Tags/PrivacyTag'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import { DV_TAB_NOTE_CHAT } from '../../../utils/TabNavigationConstants'
import DvBotButton from '../../UIControls/DvBotButton'
import DvSearchButton from '../../UIControls/DvSearchButton'

export default function TagList({
    projectId,
    note,
    assistantId,
    setAssistantId,
    disabled,
    updateObjectState,
    onOpenSideChat,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreenNoteDV)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const project = ProjectHelper.getProjectById(projectId)
    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile

    return (
        <DetailViewHeaderTags
            projectTag={<ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} truncate />}
            privacyTag={
                <PrivacyTag
                    projectId={projectId}
                    object={note}
                    objectType={FEED_NOTE_OBJECT_TYPE}
                    disabled={!accessGranted || disabled}
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
                                navItem={DV_TAB_NOTE_CHAT}
                                projectId={projectId}
                                assistantId={assistantId}
                                setAssistantId={setAssistantId}
                                objectId={note.id}
                                showThreadModelBadge={true}
                                objectType={FEED_NOTE_OBJECT_TYPE}
                                parentObject={note}
                                updateObjectState={updateObjectState}
                                onOpenSideChat={
                                    onOpenSideChat
                                        ? () => onOpenSideChat({ objectType: 'notes', objectId: note.id, projectId })
                                        : undefined
                                }
                            />
                        </>
                    )}
                    <OpenInNewWindowButton style={{ top: -5 }} />
                </>
            }
        />
    )
}
