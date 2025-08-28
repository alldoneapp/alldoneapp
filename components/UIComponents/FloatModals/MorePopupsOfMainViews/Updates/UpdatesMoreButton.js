import React, { useRef } from 'react'
import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import { useSelector } from 'react-redux'
import { FOLLOWED_TAB } from '../../../../Feeds/Utils/FeedsConstants'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'

export default function UpdatesMoreButton({ projectId, user, wrapperStyle, buttonStyle, disabled, shortcut = 'M' }) {
    const feedActiveTab = useSelector(state => state.feedActiveTab)
    const tab = feedActiveTab === FOLLOWED_TAB ? 'followed' : 'all'
    const modalRef = useRef()
    const link = projectId
        ? `${window.location.origin}/projects/${projectId}/user/${user.uid}/updates/${tab}`
        : `${window.location.origin}/updates/${tab}`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const renderItems = () => {
        const list = []

        list.push(shortcut => {
            return <CopyLinkModalItem key={'gmbtn-copy-link'} link={link} shortcut={shortcut} onPress={dismissModal} />
        })

        list.push(shortcut => {
            return <OpenInNewWindowModalItem key={'gmbtn-new-window'} shortcut={shortcut} onPress={dismissModal} />
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
