import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'
import SyncCalendarModalItem from './SyncCalendarModalItem'
import DateBarOrganizeModalItem from './DateBarOrganizeModalItem'
import { checkIfSelectedAllProjects } from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import OKRModal from '../../../../TaskListView/OKRs/OKRModal'
import AutoPostponeTasksModal from '../../../../TaskListView/AutoPostpone/AutoPostponeTasksModal'
import { DATE_TASK_INDEX, TODAY_DATE } from '../../../../../utils/backends/openTasks'
import { areEmailLineConnectionsHiddenToday } from '../../../../TaskListView/EmailLine/emailLineHelper'
import { listEmailConnections } from '../../../../../utils/IntegrationProviders'
import { clearUserEmailLineHiddenTodayForConnections } from '../../../../../utils/backends/Users/usersFirestore'

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
    // Organize / Select all act on the "Today" section of this project's task list. The date-section
    // store is keyed by `projectId + userId` and each section carries its own date string, so we find
    // the index of the section whose date is TODAY_DATE. -1 means the list isn't loaded yet / no today
    // section, in which case we don't offer the items.
    const instanceKey = projectId && userId ? `${projectId}${userId}` : null
    const todayDateIndex = useSelector(state => {
        if (!instanceKey) return -1
        const dateSections = state.filteredOpenTasksStore[instanceKey]
        if (!dateSections) return -1
        return dateSections.findIndex(section => section[DATE_TASK_INDEX] === TODAY_DATE)
    })
    const loggedUser = useSelector(state => state.loggedUser)
    const [showAddOKR, setShowAddOKR] = useState(false)
    const [showAutoPostpone, setShowAutoPostpone] = useState(false)
    const modalRef = useRef()
    const openAddOKRTimeoutRef = useRef()
    const openAutoPostponeTimeoutRef = useRef()

    const inSelectedProject = !!projectId
    const showAddOKRItem = !!projectId && projectOKRs.length === 0
    const showOrganizeItems = inSelectedProject && todayDateIndex >= 0

    // "Done for today" on the Email line hides it completely; this menu item is the
    // way to bring it back before the daily reset.
    const emailConnectionIds = listEmailConnections(loggedUser).map(connection => connection.connectionId)
    const showEmailLineItem = !inSelectedProject && areEmailLineConnectionsHiddenToday(loggedUser, emailConnectionIds)

    const link = inSelectedProject
        ? `${window.location.origin}/projects/${projectId}/user/${userId}/tasks/open`
        : `${window.location.origin}/projects/tasks/open`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const clearOpenAddOKRTimeout = () => {
        if (openAddOKRTimeoutRef.current) {
            clearTimeout(openAddOKRTimeoutRef.current)
            openAddOKRTimeoutRef.current = null
        }
    }

    const openAddOKR = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        e?.nativeEvent?.stopImmediatePropagation?.()

        clearOpenAddOKRTimeout()
        openAddOKRTimeoutRef.current = setTimeout(() => {
            openAddOKRTimeoutRef.current = null
            setShowAddOKR(true)
        })
    }

    const closeAddOKR = () => {
        clearOpenAddOKRTimeout()
        setShowAddOKR(false)
        dismissModal()
    }

    const clearOpenAutoPostponeTimeout = () => {
        if (openAutoPostponeTimeoutRef.current) {
            clearTimeout(openAutoPostponeTimeoutRef.current)
            openAutoPostponeTimeoutRef.current = null
        }
    }

    const openAutoPostpone = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        e?.nativeEvent?.stopImmediatePropagation?.()

        clearOpenAutoPostponeTimeout()
        openAutoPostponeTimeoutRef.current = setTimeout(() => {
            openAutoPostponeTimeoutRef.current = null
            setShowAutoPostpone(true)
        })
    }

    const closeAutoPostpone = () => {
        clearOpenAutoPostponeTimeout()
        setShowAutoPostpone(false)
        dismissModal()
    }

    const onCloseMainModal = () => {
        clearOpenAddOKRTimeout()
        clearOpenAutoPostponeTimeout()
        setShowAddOKR(false)
        setShowAutoPostpone(false)
    }

    useEffect(() => {
        return () => {
            clearOpenAddOKRTimeout()
            clearOpenAutoPostponeTimeout()
        }
    }, [])

    const renderItems = () => {
        const list = []

        if (showOrganizeItems) {
            list.push(shortcut => {
                return (
                    <DateBarOrganizeModalItem
                        key={'gmbtn-organize'}
                        icon={'multi-selection'}
                        text={'Organize'}
                        shortcut={shortcut}
                        onPress={dismissModal}
                        projectId={projectId}
                        dateIndex={todayDateIndex}
                        instanceKey={instanceKey}
                    />
                )
            })

            list.push(shortcut => {
                return (
                    <DateBarOrganizeModalItem
                        key={'gmbtn-select-all'}
                        icon={'multi-selection-selected'}
                        text={'Select all'}
                        shortcut={shortcut}
                        onPress={dismissModal}
                        projectId={projectId}
                        dateIndex={todayDateIndex}
                        instanceKey={instanceKey}
                        selectTasks={true}
                    />
                )
            })
        }

        list.push(shortcut => {
            return (
                <ModalItem
                    key={'gmbtn-auto-postpone'}
                    icon={'coffee'}
                    text={'Auto-postpone tasks'}
                    shortcut={shortcut}
                    onPress={openAutoPostpone}
                />
            )
        })

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

        if (showEmailLineItem) {
            list.push(shortcut => {
                return (
                    <ModalItem
                        key={'gmbtn-show-email-line'}
                        icon={'mail'}
                        text={'Show email line'}
                        shortcut={shortcut}
                        onPress={() => {
                            clearUserEmailLineHiddenTodayForConnections(loggedUser.uid, emailConnectionIds)
                            dismissModal()
                        }}
                    />
                )
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
            customModal={
                showAddOKR ? (
                    <OKRModal projectId={projectId} closePopover={closeAddOKR} />
                ) : showAutoPostpone ? (
                    <AutoPostponeTasksModal projectId={projectId} closePopover={closeAutoPostpone} />
                ) : null
            }
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
