import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import TimeTag from './TimeTag'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { setTaskAutoEstimation, setTaskEstimations } from '../../utils/backends/Tasks/tasksFirestore'
import { getTaskAutoEstimation } from '../TaskListView/Utils/TasksHelper'

export default function TimeTagWrapper({ projectId, task }) {
    const dispatch = useDispatch()
    const [showModal, setShowModal] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)

    const { stepHistory, time, estimations, autoEstimation, isSubtask } = task

    const currentStepId = stepHistory[stepHistory.length - 1]

    const setEstimation = estimation => {
        setTaskEstimations(projectId, task.id, task, currentStepId, estimation)
    }

    const openModal = e => {
        dispatch(showFloatPopup())
        setTimeout(() => {
            setShowModal(true)
        })
    }

    const closeModal = () => {
        setShowModal(false)
        dispatch(hideFloatPopup())
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    const estimation = estimations[currentStepId] || 0
    return (
        <Popover
            content={
                <EstimationModal
                    projectId={projectId}
                    estimation={estimation}
                    setEstimationFn={setEstimation}
                    closePopover={closeModal}
                    autoEstimation={getTaskAutoEstimation(projectId, estimation, autoEstimation)}
                    setAutoEstimation={setAutoEstimation}
                    showAutoEstimation={!isSubtask}
                    disabled={!!task.calendarData}
                />
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <TimeTag time={time} onPress={openModal} containerStyle={{ marginRight: 8 }} />
        </Popover>
    )
}
