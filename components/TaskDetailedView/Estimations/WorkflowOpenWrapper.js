import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import WorkflowOpen from './WorkflowOpen'
import EstimationModal from '../../UIComponents/FloatModals/EstimationModal/EstimationModal'
import { getTaskAutoEstimation, OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import { setTaskAutoEstimation, setTaskEstimations } from '../../../utils/backends/Tasks/tasksFirestore'

export default function WorkflowOpenWrapper({ onStepPress, currentEstimation, task, projectId, disabled }) {
    const [showPopup, setShowPopup] = useState(false)

    const isCurrentStep = task.userIds.length === 1 && task.inDone === false
    const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
    const notInOpen = task.userIds.length > 1 || task.inDone

    const openModal = () => {
        setShowPopup(true)
    }

    const closeModal = () => {
        setShowPopup(false)
    }

    const setEstimation = estimation => {
        setTaskEstimations(projectId, task.id, task, OPEN_STEP, estimation)
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
                    disabled={isAssistant || notInOpen || !!task.calendarData}
                />
            }
            onClickOutside={closeModal}
            isOpen={showPopup}
            padding={4}
            contentLocation={null}
        >
            <WorkflowOpen
                isCurrentStep={isCurrentStep}
                onStepPress={onStepPress}
                projectId={projectId}
                showModal={openModal}
                currentEstimation={currentEstimation}
                disabled={disabled}
            />
        </Popover>
    )
}
