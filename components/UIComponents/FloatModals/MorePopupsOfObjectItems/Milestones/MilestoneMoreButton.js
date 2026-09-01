import React, { useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import MoreButtonWrapper from '../../MorePopupsOfMainViews/Common/MoreButtonWrapper'
import OrganizeModalItem from '../../MorePopupsOfMainViews/Tasks/OrganizeModalItem'
import { BACKLOG_MILESTONE_ID } from '../../../../GoalsView/GoalsHelper'
import DoneModalItem from './DoneModalItem'
import DoneModalItemWrapper from './DoneModalItemWrapper'
import Backend from '../../../../../utils/BackendBridge'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import DeleteAllGoalslItem from './DeleteAllGoalslItem'
import SortAlphabeticallyItem from './SortAlphabeticallyItem'
import ProjectHelper from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_GUIDE } from '../../../../SettingsView/ProjectsSettings/ProjectsSettings'
import { ALL_GOALS_ID } from '../../../../AllSections/allSectionHelper'

export default function MilestoneMoreButton({ projectId, milestone, firstMilestoneId, goals, shortcut = 'M' }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [showDoneStateModal, setShowDoneStateModal] = useState(false)
    const modalRef = useRef()

    const projectIsGuide = ProjectHelper.getTypeOfProject(loggedUser, projectId) === PROJECT_TYPE_GUIDE

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const moveMilestoneToOpen = () => {
        dismissModal()
        Backend.updateMilestoneDoneState(projectId, milestone)
    }

    const moveMilestoneToDone = () => {
        closeDoneStateModal()
        Backend.updateMilestoneDoneState(projectId, milestone)
    }

    const openDoneStateModal = () => {
        dismissModal()
        setShowDoneStateModal(true)
        dispatch(showFloatPopup())
    }

    const closeDoneStateModal = () => {
        setShowDoneStateModal(false)
        dispatch(hideFloatPopup())
    }

    const renderItems = () => {
        const list = []

        if (!milestone.id.startsWith(BACKLOG_MILESTONE_ID)) {
            list.push(shortcut => {
                return (
                    <DoneModalItem
                        key={'mbtn-done-milestone'}
                        milestone={milestone}
                        firstMilestoneId={firstMilestoneId}
                        shortcut={shortcut}
                        onPress={milestone.done ? moveMilestoneToOpen : openDoneStateModal}
                    />
                )
            })
        }

        if (projectIsGuide || currentUserId === ALL_GOALS_ID) {
            list.push(shortcut => {
                return (
                    <OrganizeModalItem
                        key={'mmbtn-organize'}
                        shortcut={shortcut}
                        onPress={dismissModal}
                        parentObjectId={milestone.id}
                    />
                )
            })
        }

        if (projectIsGuide || currentUserId === ALL_GOALS_ID) {
            list.push(shortcut => {
                return (
                    <SortAlphabeticallyItem
                        key={'mmbtn-sortAlpha'}
                        shortcut={shortcut}
                        onPress={dismissModal}
                        projectId={projectId}
                        goals={goals}
                        milestoneId={milestone.id}
                    />
                )
            })
        }

        list.push(shortcut => {
            return (
                <DeleteAllGoalslItem
                    key={'mmbtn-deleteAll'}
                    shortcut={shortcut}
                    onPress={dismissModal}
                    projectId={projectId}
                    goals={goals}
                />
            )
        })

        return list
    }

    return showDoneStateModal ? (
        <DoneModalItemWrapper
            projectId={projectId}
            milestoneDate={milestone.date}
            moveMilestone={moveMilestoneToDone}
            closeModal={closeDoneStateModal}
        />
    ) : (
        <MoreButtonWrapper ref={modalRef} shortcut={shortcut} popupAlign={'end'}>
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
