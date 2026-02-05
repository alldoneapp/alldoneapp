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
        console.log('ParentGoalWrapper openModal called:', {
            taskParentGoalId: task.parentGoalId,
            activeGoal: activeGoal ? { id: activeGoal.id, name: activeGoal.extendedName } : null,
            isOpen,
        })
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
        setActiveGoal(goal)

        // Check if the goal is from a different project
        if (goal && goalProjectId && goalProjectId !== projectId) {
            // Move the task to the goal's project and assign the goal
            const currentProject = ProjectHelper.getProjectById(projectId)
            const newProject = ProjectHelper.getProjectById(goalProjectId)
            if (currentProject && newProject) {
                setTaskProjectWithGoal(currentProject, newProject, task, goal)
            }
        } else {
            // Same project, just update the parent goal
            setTaskParentGoal(projectId, task.id, task, goal ? goal : null)
        }
    }

    useEffect(() => {
        console.log('ParentGoalWrapper useEffect:', {
            taskParentGoalId: task.parentGoalId,
            projectId,
            currentActiveGoal: activeGoal ? { id: activeGoal.id, name: activeGoal.extendedName } : null,
        })
        if (task.parentGoalId) {
            const watcherKey = v4()
            Backend.watchGoal(projectId, task.parentGoalId, watcherKey, goal => {
                console.log(
                    'ParentGoalWrapper goal loaded from Backend:',
                    goal ? { id: goal.id, name: goal.extendedName } : null
                )
                setActiveGoal(goal)
            })
            return () => {
                Backend.unwatch(projectId, watcherKey)
            }
        } else {
            console.log('ParentGoalWrapper: No parentGoalId, setting activeGoal to null')
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
