import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useSelector, useDispatch } from 'react-redux'

import GoalAssigneeCapacityModal from '../UIComponents/FloatModals/GoalAssigneeCapacityModal/GoalAssigneeCapacityModal'
import Backend from '../../utils/BackendBridge'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import GoalAssigneeCapacityTag from './GoalAssigneeCapacityTag'

export default function GoalAssigneeCapacityWrapper({
    capacity,
    assignee,
    goal,
    projectId,
    tagStyle,
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
        if (capacity !== capacityKey) {
            Backend.updateGoalAssigneeCapacity(projectId, goal, capacity, capacityKey, assignee.uid)
        }
    }

    return (
        <Popover
            content={
                <GoalAssigneeCapacityModal
                    capacitySelected={capacity}
                    closeModal={closeModal}
                    updateCapacity={updateCapacity}
                    assigneeId={assignee.uid}
                    projectId={projectId}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <GoalAssigneeCapacityTag
                openModal={openModal}
                assignee={assignee}
                capacity={capacity}
                containerStyle={[{ marginLeft: 8, marginRight: 0 }, tagStyle]}
                disabled={disabled}
            />
        </Popover>
    )
}
