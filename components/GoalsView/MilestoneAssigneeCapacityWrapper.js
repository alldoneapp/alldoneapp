import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import GoalSprintCapacityModal from '../UIComponents/FloatModals/GoalSprintCapacityModal/GoalSprintCapacityModal'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import MilestoneAssigneeCapacityTag from './MilestoneAssigneeCapacityTag'
import Backend from '../../utils/BackendBridge'

export default function MilestoneAssigneeCapacityWrapper({
    projectId,
    milestoneId,
    assignee,
    capacityDate,
    automaticCapacity,
    milestoneCapacity,
    disabled = false,
}) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const updateCapacity = capacityKey => {
        closeModal()
        if (capacityKey !== capacityDate) {
            Backend.updateGoalMilestoneAssigneesCapacity(projectId, milestoneId, capacityKey, assignee.uid)
        }
    }

    return (
        <Popover
            content={
                <GoalSprintCapacityModal
                    capacitySelected={capacityDate}
                    closeModal={closeModal}
                    updateCapacity={updateCapacity}
                    assigneeId={assignee.uid}
                    automaticCapacity={automaticCapacity}
                    projectId={projectId}
                />
            }
            align={'start'}
            position={['bottom', 'top', 'right', 'left']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <MilestoneAssigneeCapacityTag
                disabled={isOpen || disabled}
                openModal={openModal}
                assignee={assignee}
                milestoneCapacity={milestoneCapacity}
            />
        </Popover>
    )
}
