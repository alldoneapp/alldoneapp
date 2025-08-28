import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import GoalMilestoneRangeModal from '../../UIComponents/FloatModals/GoalMilestoneRangeModal/GoalMilestoneRangeModal'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { GOAL_DATE_RANGE_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import ParentMilestonesTag from '../ParentMilestonesTag'
import Backend from '../../../utils/BackendBridge'

export default function ParentMilestonesWrapper({ projectId, goal, parentMilestonesData, tagStyle, disabled }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { startingMilestoneDate, completionMilestoneDate } = goal

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(GOAL_DATE_RANGE_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        removeModal(GOAL_DATE_RANGE_MODAL_ID)
    }

    const updateMilestoneDateRange = (newDate, rangeEdgePropertyName) => {
        closeModal()
        if (goal[rangeEdgePropertyName] !== newDate) {
            Backend.updateGoalDateRange(projectId, goal, newDate, rangeEdgePropertyName, true)
        }
    }

    return (
        <Popover
            content={
                <GoalMilestoneRangeModal
                    projectId={projectId}
                    closeModal={closeModal}
                    updateMilestoneDateRange={updateMilestoneDateRange}
                    startingMilestoneDate={startingMilestoneDate}
                    completionMilestoneDate={completionMilestoneDate}
                    ownerId={goal.ownerId}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <ParentMilestonesTag
                style={tagStyle}
                onPress={openModal}
                parentMilestonesData={parentMilestonesData}
                disabled={disabled}
            />
        </Popover>
    )
}
