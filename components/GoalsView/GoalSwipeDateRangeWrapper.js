import React, { useState } from 'react'
import { Dimensions, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import GoalMilestoneRangeModal from '../UIComponents/FloatModals/GoalMilestoneRangeModal/GoalMilestoneRangeModal'
import Backend from '../../utils/BackendBridge'

export default function GoalSwipeDateRangeWrapper({
    goal,
    projectId,
    closeMiletsoneModal,
    startingMilestoneDate,
    completionMilestoneDate,
    openMilestoneModal,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [modalHeight, setModalHeight] = useState(0)
    const [modalWidth, setModalWidth] = useState(0)

    const updateMilestoneDateRange = async (date, rangeEdgePropertyName) => {
        closeMiletsoneModal()
        if (goal[rangeEdgePropertyName] !== date) {
            Backend.updateGoalDateRange(projectId, goal, date, rangeEdgePropertyName, true)
        }
    }

    const updateModalLocation = () => {
        const MENU_WIDTH = smallScreenNavigation ? 0 : 263

        const windowDimensions = Dimensions.get('window')
        const windowWidth = windowDimensions.width
        const windowHeight = windowDimensions.height

        const left = (windowWidth - modalWidth + MENU_WIDTH) * 0.5
        const top = (windowHeight - modalHeight) * 0.5

        return { left, top }
    }

    return (
        <Popover
            content={
                <GoalMilestoneRangeModal
                    projectId={projectId}
                    closeModal={closeMiletsoneModal}
                    updateMilestoneDateRange={updateMilestoneDateRange}
                    startingMilestoneDate={startingMilestoneDate}
                    completionMilestoneDate={completionMilestoneDate}
                    setModalWidth={setModalWidth}
                    setModalHeight={setModalHeight}
                    ownerId={goal.ownerId}
                />
            }
            align={'center'}
            position={['top']}
            onClickOutside={closeMiletsoneModal}
            isOpen={openMilestoneModal}
            contentLocation={openMilestoneModal ? updateModalLocation() : null}
        >
            <View />
        </Popover>
    )
}
