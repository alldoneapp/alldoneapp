import React, { useEffect, useRef, useState } from 'react'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import { useSelector } from 'react-redux'

import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import TimeTag from './TimeTag'
import { setTaskAutoEstimation, setTaskEstimations } from '../../utils/backends/Tasks/tasksFirestore'
import { getTaskAutoEstimation } from '../TaskListView/Utils/TasksHelper'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'

export default function TimeTagWrapper({ projectId, task }) {
    const [showModal, setShowModal] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    const openTimeoutRef = useRef(null)
    const popupLock = useFloatPopupLock()

    const { stepHistory, time, estimations, autoEstimation, isSubtask } = task

    const currentStepId = stepHistory[stepHistory.length - 1]

    const setEstimation = estimation => {
        setTaskEstimations(projectId, task.id, task, currentStepId, estimation)
    }

    useEffect(() => {
        return () => {
            if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current)
        }
    }, [])

    const openModal = () => {
        if (popupLock.isAcquired()) return

        popupLock.acquire()
        openTimeoutRef.current = setTimeout(() => {
            openTimeoutRef.current = null
            setShowModal(true)
        })
    }

    const closeModal = () => {
        if (openTimeoutRef.current) {
            clearTimeout(openTimeoutRef.current)
            openTimeoutRef.current = null
        }
        setShowModal(false)
        popupLock.release()
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    const estimation = estimations[currentStepId] || 0
    return (
        <AppPopover
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
        </AppPopover>
    )
}
