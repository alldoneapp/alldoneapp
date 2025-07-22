import React, { useRef } from 'react'
import { useSelector } from 'react-redux'

import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'
import SyncCalendarModalItem from './SyncCalendarModalItem'
import { checkIfSelectedAllProjects } from '../../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function TaskHeaderMoreButton({ userId, wrapperStyle, buttonStyle, disabled, shortcut = 'M' }) {
    const projectId = useSelector(state => {
        const { selectedProjectIndex, loggedUserProjects } = state

        return checkIfSelectedAllProjects(selectedProjectIndex)
            ? null
            : loggedUserProjects[selectedProjectIndex]
            ? loggedUserProjects[selectedProjectIndex].id
            : null
    })
    const modalRef = useRef()

    const inSelectedProject = !!projectId

    const link = inSelectedProject
        ? `${window.location.origin}/projects/${projectId}/user/${userId}/tasks/open`
        : `${window.location.origin}/projects/tasks/open`

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

        if (!inSelectedProject) {
            list.push(shortcut => {
                return <SyncCalendarModalItem key={'gmbtn-sync-calendar'} shortcut={shortcut} onPress={dismissModal} />
            })
        }

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
