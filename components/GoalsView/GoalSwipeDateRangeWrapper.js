import React, { useState } from 'react'
import { View } from 'react-native'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import GoalMilestoneRangeModal from '../UIComponents/FloatModals/GoalMilestoneRangeModal/GoalMilestoneRangeModal'
import Backend from '../../utils/BackendBridge'
import { centerPopoverInWindow } from '../../utils/popoverPositioning'
import { SIDEBAR_MENU_WIDTH } from '../styles/global'

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

    const updateMilestoneDateRange = async (date, rangeEdgePropertyName, milestone) => {
        closeMiletsoneModal()
        Backend.updateGoalDateRange(projectId, goal, date, rangeEdgePropertyName, true, milestone?.milestoneType)
    }

    // AT-2339: this was a hand-rolled copy of centerPopoverInWindow — the same
    // "centre in the window, offset by half the sidebar" math, but against the
    // RAW viewport and with no clamp, so a card taller than the safe rectangle
    // centred with its header under the status bar. The shared helper centres
    // within the safe rectangle and pins an oversized modal to the top edge
    // instead of giving it a negative top (AT-2189).
    const updateModalLocation = () =>
        centerPopoverInWindow(
            { popoverRect: { width: modalWidth, height: modalHeight } },
            smallScreenNavigation ? 0 : SIDEBAR_MENU_WIDTH / 2
        )

    return (
        <AppPopover
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
                    scheduleMode={goal.scheduleMode}
                />
            }
            align={'center'}
            position={['top']}
            onClickOutside={closeMiletsoneModal}
            isOpen={openMilestoneModal}
            contentLocation={openMilestoneModal ? updateModalLocation() : null}
        >
            <View />
        </AppPopover>
    )
}
