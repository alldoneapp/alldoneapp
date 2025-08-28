import React, { useRef } from 'react'
import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import { useSelector } from 'react-redux'
import { FOLLOWED_TAB } from '../../../../Feeds/Utils/FeedsConstants'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'

export default function NoteMoreButton({ projectId, user, wrapperStyle, buttonStyle, disabled, shortcut = 'M' }) {
    const notesActiveTab = useSelector(state => state.notesActiveTab)
    const tab = notesActiveTab === FOLLOWED_TAB ? 'followed' : 'all'
    const modalRef = useRef()
    const link = projectId
        ? `${window.location.origin}/projects/${projectId}/user/${user.uid}/notes/${tab}`
        : `${window.location.origin}/projects/notes/${tab}`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const renderItems = () => {
        const list = []

        list.push(shortcut => {
            return <CopyLinkModalItem key={'gmbtn-copy-link'} link={link} shortcut={shortcut} onPress={dismissModal} />
        })

        list.push(shortcut => {
            return <OpenInNewWindowModalItem key={'gmbtn-open-new-win'} shortcut={shortcut} onPress={dismissModal} />
        })

        return list
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            buttonStyle={buttonStyle}
            disabled={disabled}
            shortcut={shortcut}
            wrapperStyle={wrapperStyle}
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
