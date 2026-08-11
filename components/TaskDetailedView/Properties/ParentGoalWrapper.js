import React, { useState, useEffect } from 'react'
import v4 from 'uuid/v4'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import ParentGoalButton from './ParentGoalButton'
import TaskParentGoalModal from '../../UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal'
import { exitsOpenModals, PRIVACY_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID } from '../../ModalsManager/modalsManager'
import Backend from '../../../utils/BackendBridge'
import { setTaskParentGoal, setTaskProjectWithGoal } from '../../../utils/backends/Tasks/tasksFirestore'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ParentGoalWrapper({ projectId, task, disabled }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const [activeGoal, setActiveGoal] = useState(null)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModalWhenClickOutside = () => {
        if (!exitsOpenModals([TASK_PARENT_GOAL_MODAL_ID])) {
            setIsOpen(false)
        }
    }

    const closeModal = () => {
        if (!exitsOpenModals([TASK_PARENT_GOAL_MODAL_ID, PRIVACY_MODAL_ID])) {
            setIsOpen(false)
        }
    }

    const updateGoal = (goal, goalProjectId) => {
        // Use the goal's projectId if the second argument wasn't passed
        const effectiveGoalProjectId = goalProjectId || goal?.projectId

        setActiveGoal(goal)

        // Check if the goal is from a different project
        if (goal && effectiveGoalProjectId && effectiveGoalProjectId !== projectId) {
            // Move the task to the goal's project and assign the goal
            const currentProject = ProjectHelper.getProjectById(projectId)
            const newProject = ProjectHelper.getProjectById(effectiveGoalProjectId)
            if (currentProject && newProject) {
                setTaskProjectWithGoal(currentProject, newProject, task, goal)
            }
        } else {
            // Same project, just update the parent goal
            setTaskParentGoal(projectId, task.id, task, goal ? goal : null)
        }
    }

    useEffect(() => {
        if (task.parentGoalId) {
            const watcherKey = v4()
            Backend.watchGoal(projectId, task.parentGoalId, watcherKey, goal => {
                setActiveGoal(goal)
            })
            return () => {
                Backend.unwatch(projectId, watcherKey)
            }
        } else {
            setActiveGoal(null)
        }
    }, [task.parentGoalId, projectId])

    return (
        <Popover
            content={
                <TaskParentGoalModal
                    key={isOpen}
                    activeGoal={activeGoal}
                    setActiveGoal={updateGoal}
                    projectId={projectId}
                    closeModal={closeModal}
                    ownerId={task.userId}
                />
            }
            isOpen={isOpen}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            onClickOutside={closeModalWhenClickOutside}
            contentLocation={mobile ? null : undefined}
        >
            <ParentGoalButton activeGoal={activeGoal} onPress={openModal} disabled={disabled} />
        </Popover>
    )
}
