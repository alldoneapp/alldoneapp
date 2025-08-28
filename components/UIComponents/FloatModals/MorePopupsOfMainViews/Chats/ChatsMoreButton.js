import React, { useRef } from 'react'
import { difference } from 'lodash'
import { useSelector } from 'react-redux'

import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import { FOLLOWED_TAB } from '../../../../Feeds/Utils/FeedsConstants'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'
import { markMessagesAsRead } from '../../../../../utils/backends/Chats/chatsComments'
import { checkIfSelectedAllProjects } from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../../../redux/store'

export default function ChatsMoreButton({ projectId, userId, wrapperStyle, buttonStyle, disabled }) {
    const contactsActiveTab = useSelector(state => state.contactsActiveTab)
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const tab = contactsActiveTab === FOLLOWED_TAB ? 'followed' : 'all'
    const modalRef = useRef()
    const link = projectId
        ? `${window.location.origin}/projects/${projectId}/user/${userId}/chats/${tab}`
        : `${window.location.origin}/projects/chats/${tab}`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const markRead = () => {
        if (checkIfSelectedAllProjects(selectedProjectIndex)) {
            const { loggedUser } = store.getState()
            const { realProjectIds, realTemplateProjectIds, realArchivedProjectIds } = loggedUser

            const guidesAndNormalProjectIds = difference(realProjectIds, realTemplateProjectIds, realArchivedProjectIds)
            guidesAndNormalProjectIds.forEach(projectId => {
                markMessagesAsRead(projectId, userId, chatsActiveTab)
            })
        } else {
            markMessagesAsRead(projectId, userId, chatsActiveTab)
        }
        dismissModal()
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut={'M'}
            wrapperStyle={wrapperStyle}
        >
            <CopyLinkModalItem key={'gmbtn-copy-link'} link={link} shortcut={'1'} onPress={dismissModal} />
            <OpenInNewWindowModalItem key={'gmbtn-open-new-win'} shortcut={'2'} onPress={dismissModal} />
            <ModalItem
                key={'gmbtn-mark-unread'}
                icon={'double-check'}
                text={'Mark all unread as read'}
                onPress={markRead}
                shortcut={'3'}
            />
        </MoreButtonWrapper>
    )
}
