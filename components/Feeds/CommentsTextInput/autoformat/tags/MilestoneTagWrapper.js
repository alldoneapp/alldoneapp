import React, { useEffect, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import MilestoneDateTag from '../../../../GoalsView/MilestoneDateTag'
import moment from 'moment'
import { getDateFormat } from '../../../../UIComponents/FloatModals/DateFormatPickerModal'
import GoalMilestoneModal from '../../../../UIComponents/FloatModals/GoalMilestoneModal/GoalMilestoneModal'
import { getNewDefaultGoalMilestone } from '../../../../GoalsView/GoalsHelper'
import Backend from '../../../../../utils/BackendBridge'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import GoalOrganizationModal from '../../../../UIComponents/FloatModals/GoalOrganizationModal'
import { BACKLOG_DATE_NUMERIC } from '../../../../TaskListView/Utils/TasksHelper'

export default function MilestoneTagWrapper({ milestoneId, text }) {
    const ORGANIZATION_MODAL_IS_OPEN = 0
    const MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE = 1
    const MILESTONE_MODAL_IS_OPEN_IN_THIS_MILESTONE_AND_LATER_MODE = 2
    const MODALS_ARE_CLOSED = 3

    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectId = useSelector(state => state.quillEditorProjectId)
    const dispatch = useDispatch()
    const [modalsState, setModalsState] = useState(MODALS_ARE_CLOSED)
    const [milestone, setMilestone] = useState({ id: '', ...getNewDefaultGoalMilestone() })
    const [isOpen, setIsOpen] = useState(false)

    const openOrganizationModal = () => {
        setModalsState(ORGANIZATION_MODAL_IS_OPEN)
    }

    const openMilestoneModalInOnlyThisMilestoneMode = () => {
        setModalsState(MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE)
    }

    const openMilestoneModalInOnlyThisMilestoneAndLaterMode = () => {
        setModalsState(MILESTONE_MODAL_IS_OPEN_IN_THIS_MILESTONE_AND_LATER_MODE)
    }

    const openModal = () => {
        setIsOpen(true)
        setModalsState(ORGANIZATION_MODAL_IS_OPEN)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        setModalsState(MODALS_ARE_CLOSED)
        dispatch(hideFloatPopup())
    }

    const selectMilestone = async date => {
        if (milestone.id && milestone.date !== date) {
            const updatedMilestone = { ...milestone }
            date === BACKLOG_DATE_NUMERIC
                ? Backend.updateMilestoneDateToBacklog(projectId, updatedMilestone)
                : Backend.updateMilestoneDate(projectId, updatedMilestone, date)
            closeModal()
        }
    }

    const selectMilestoneForThisAndLater = async newDate => {
        if (milestone.date !== newDate) {
            const updatedMilestone = { ...milestone }
            newDate === BACKLOG_DATE_NUMERIC
                ? Backend.updateFutureOpenMilestonesDateToBacklog(projectId, updatedMilestone)
                : Backend.updateFutureOpenMilestonesDate(projectId, updatedMilestone, newDate)
            closeModal()
        }
    }

    useEffect(() => {
        const fetchMilestone = async () => {
            const milestone = await Backend.getMilestoneData(projectId, milestoneId)
            setMilestone(milestone)
        }
        fetchMilestone()
    }, [])

    return (
        <Popover
            content={
                modalsState === ORGANIZATION_MODAL_IS_OPEN ? (
                    <GoalOrganizationModal
                        closeModal={closeModal}
                        organizeOnlyThisMilestoneGoals={openMilestoneModalInOnlyThisMilestoneMode}
                        organizeOnlyThisAndLaterMilestonesGoals={openMilestoneModalInOnlyThisMilestoneAndLaterMode}
                    />
                ) : modalsState === MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE ||
                  modalsState === MILESTONE_MODAL_IS_OPEN_IN_THIS_MILESTONE_AND_LATER_MODE ? (
                    <GoalMilestoneModal
                        projectId={projectId}
                        closeModal={closeModal}
                        updateMilestone={
                            modalsState === MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE
                                ? selectMilestone
                                : selectMilestoneForThisAndLater
                        }
                        milestoneDate={milestone.date}
                        openOrganizationModal={openOrganizationModal}
                        ownerId={milestone.ownerId}
                    />
                ) : (
                    <View />
                )
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            {milestoneId ? (
                <TouchableOpacity onPress={openModal} accessible={false} style={{ display: 'inline-flex' }}>
                    <MilestoneDateTag date={moment(text, getDateFormat())} style={{ display: 'inline-flex', top: 4 }} />
                </TouchableOpacity>
            ) : (
                <View />
            )}
        </Popover>
    )
}
