import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import WorkflowStep from './WorkflowStep'
import EstimationModal from '../../UIComponents/FloatModals/EstimationModal/EstimationModal'
import { setTaskAutoEstimation, setTaskEstimations } from '../../../utils/backends/Tasks/tasksFirestore'
import { getTaskAutoEstimation } from '../../TaskListView/Utils/TasksHelper'

export default function WorkflowStepWrapper({
    onStepPress,
    currentEstimation,
    isCurrentStep,
    stepNumber,
    step,
    task,
    projectId,
    disabled,
    isBeforeCurrentStep,
}) {
    const [showPopup, setShowPopup] = useState(false)

    const openModal = () => {
        setShowPopup(true)
    }

    const closeModal = () => {
        setShowPopup(false)
    }

    const setEstimation = estimation => {
        setTaskEstimations(projectId, task.id, task, step.id, estimation)
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    return (
        <Popover
            content={
                <EstimationModal
                    projectId={projectId}
                    estimation={currentEstimation}
                    setEstimationFn={setEstimation}
                    closePopover={closeModal}
                    autoEstimation={getTaskAutoEstimation(projectId, currentEstimation, task.autoEstimation)}
                    setAutoEstimation={setAutoEstimation}
                    showAutoEstimation={!task.isSubtask}
                    disabled={isBeforeCurrentStep || !!task.calendarData}
                />
            }
            onClickOutside={closeModal}
            isOpen={showPopup}
            padding={4}
            contentLocation={null}
        >
            <WorkflowStep
                onPress={onStepPress}
                showModal={openModal}
                currentEstimation={currentEstimation}
                isCurrentStep={isCurrentStep}
                stepNumber={stepNumber}
                step={step}
                projectId={projectId}
                disabled={disabled}
            />
        </Popover>
    )
}
