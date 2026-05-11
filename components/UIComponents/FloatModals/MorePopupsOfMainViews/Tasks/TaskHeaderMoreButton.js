import React, { useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'
import SyncCalendarModalItem from './SyncCalendarModalItem'
import { checkIfSelectedAllProjects } from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import OKRModal from '../../../../TaskListView/OKRs/OKRModal'

export default function TaskHeaderMoreButton({
    projectIdOverride,
    userId,
    wrapperStyle,
    buttonStyle,
    disabled,
    shortcut = 'M',
    iconSize,
}) {
    const selectedProjectId = useSelector(state => {
        const { selectedProjectIndex, loggedUserProjects } = state

        return checkIfSelectedAllProjects(selectedProjectIndex)
            ? null
            : loggedUserProjects[selectedProjectIndex]
            ? loggedUserProjects[selectedProjectIndex].id
            : null
    })
    const projectId = projectIdOverride || selectedProjectId
    const projectOKRs = useSelector(state => (projectId ? state.okrsByProjectInTasks[projectId] || [] : []))
    const [showAddOKR, setShowAddOKR] = useState(false)
    const modalRef = useRef()

    const inSelectedProject = !!projectId
    const showAddOKRItem = !!projectId && projectOKRs.length === 0

    const link = inSelectedProject
        ? `${window.location.origin}/projects/${projectId}/user/${userId}/tasks/open`
        : `${window.location.origin}/projects/tasks/open`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const openAddOKR = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        setShowAddOKR(true)
    }

    const closeAddOKR = () => {
        setShowAddOKR(false)
        dismissModal()
    }

    const onCloseMainModal = () => {
        setShowAddOKR(false)
    }

    const renderItems = () => {
        const list = []

        if (showAddOKRItem) {
            list.push(shortcut => {
                return (
                    <ModalItem
                        key={'gmbtn-add-okr'}
                        icon={'plus-square'}
                        text={'Add OKR'}
                        shortcut={shortcut}
                        onPress={openAddOKR}
                    />
                )
            })
        }

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
            iconSize={iconSize}
            onCloseModal={onCloseMainModal}
            customModal={showAddOKR ? <OKRModal projectId={projectId} closePopover={closeAddOKR} /> : null}
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
