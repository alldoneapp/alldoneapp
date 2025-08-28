import React, { useRef, useState } from 'react'
import { Keyboard } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import MoreButtonWrapper from '../Common/MoreButtonWrapper'
import CopyLinkModalItem from '../../MorePopupsOfEditModals/Common/CopyLinkModalItem'
import GenericModalItem from '../../MorePopupsOfEditModals/Common/GenericModalItem'
import { removeModal, RICH_CREATE_TASK_MODAL_ID, storeModal } from '../../../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import RichCreateTaskModal from '../../RichCreateTaskModal/RichCreateTaskModal'
import { FEED_PUBLIC_FOR_ALL } from '../../../../Feeds/Utils/FeedsConstants'
import TasksHelper, { RECURRENCE_WEEKLY } from '../../../../TaskListView/Utils/TasksHelper'
import { checkIfSelectedProject } from '../../../../SettingsView/ProjectsSettings/ProjectHelper'
import OpenInNewWindowModalItem from '../Common/OpenInNewWindowModalItem'
import { translate } from '../../../../../i18n/TranslationService'

export default function GoalMoreButton() {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const projectId = useSelector(state =>
        state.loggedUserProjects[selectedProjectIndex] ? state.loggedUserProjects[selectedProjectIndex].id : null
    )
    const [showWeeklyTaskPopup, setShowWeeklyTaskPopup] = useState(false)
    const modalRef = useRef()

    const link = projectId
        ? `${window.location.origin}/projects/${projectId}/user/${currentUserId}/goals/open`
        : `${window.location.origin}/projects/goals/open`

    const dismissModal = () => {
        modalRef?.current?.close()
    }

    const openPopup = (e, constant, setVisibilityModal) => {
        e?.preventDefault()
        e?.stopPropagation()
        Keyboard.dismiss()
        if (constant) storeModal(constant)
        dispatch(showFloatPopup())
        setVisibilityModal(true)
    }

    const hidePopups = (setVisibilityModal, modalId) => {
        if (modalId) removeModal(modalId)
        dispatch(hideFloatPopup())
        setVisibilityModal(false)
    }

    const getInitialTask = () => {
        const newTask = TasksHelper.getNewDefaultTask()
        const taskName = `Update goals ${window.location.origin}/projects/${projectId}/user/${currentUserId}/goals/open`
        newTask.name = taskName
        newTask.extendedName = taskName
        newTask.userId = loggedUserId
        newTask.userIds = [loggedUserId]
        newTask.currentReviewerId = loggedUserId
        newTask.isPublicFor = [FEED_PUBLIC_FOR_ALL, loggedUserId]
        newTask.creatorId = loggedUserId
        newTask.recurrence = RECURRENCE_WEEKLY
        return newTask
    }

    const renderItems = () => {
        const list = []

        list.push(shortcut => {
            return <CopyLinkModalItem key={'gmbtn-copy-link'} link={link} shortcut={shortcut} onPress={dismissModal} />
        })

        if (checkIfSelectedProject(selectedProjectIndex)) {
            list.push(shortcut => {
                return (
                    <GenericModalItem
                        key={'gmbtn-check-weekly'}
                        icon={'check-square'}
                        text={'Add task to update Goals weekly'}
                        visibilityData={{
                            openPopup,
                            constant: RICH_CREATE_TASK_MODAL_ID,
                            visibilityFn: setShowWeeklyTaskPopup,
                        }}
                        shortcut={shortcut}
                    />
                )
            })
        }

        list.push(shortcut => {
            return <OpenInNewWindowModalItem key={'gmbtn-open-new-win'} shortcut={shortcut} onPress={dismissModal} />
        })

        return list
    }

    return (
        <MoreButtonWrapper
            ref={modalRef}
            shortcut={'M'}
            customModal={
                showWeeklyTaskPopup ? (
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        initialTask={getInitialTask()}
                        modalTitle={translate('Add task to update Goals weekly')}
                        closeModal={() => hidePopups(setShowWeeklyTaskPopup, RICH_CREATE_TASK_MODAL_ID)}
                        triggerWhenCreateTask={dismissModal}
                    />
                ) : null
            }
        >
            {renderItems().map((item, index) => item((index + 1).toString()))}
        </MoreButtonWrapper>
    )
}
