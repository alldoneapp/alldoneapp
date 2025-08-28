import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'

import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import TasksHelper from './Utils/TasksHelper'
import store from '../../redux/store'

export default function TasksMultiToggleSwitchAllProjects() {
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const workflow = useSelector(state => state.currentUser.workflow)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const currentSectionIndex = useSelector(state => state.taskViewToggleIndex)
    const openTasksAmount = useSelector(state => state.openTasksAmount)
    const doneTasksAmount = useSelector(state => state.doneTasksAmount)
    const earlierDoneTasksAmount = useSelector(state => state.earlierDoneTasksAmount)
    const workflowTasksAmount = useSelector(state => state.workflowTasksAmount.amount)
    const [haveWorkflow, setHaveWorkflow] = useState(false)

    const checkIfHaveWorkflow = () => {
        const { loggedUserProjects } = store.getState()
        for (let project of loggedUserProjects) {
            const haveWorkflowInProject =
                workflow && workflow[project.id] && Object.keys(workflow[project.id]).length > 0
            if (haveWorkflowInProject) return true
        }
        return false
    }

    const onChangeToggleOption = (index, optionText) => {
        TasksHelper.setURLOnChangeToggleOption(index, optionText)
    }

    useEffect(() => {
        const haveWorkflow = checkIfHaveWorkflow()
        setHaveWorkflow(haveWorkflow)
    }, [selectedProjectIndex, loggedUserProjectsAmount, JSON.stringify(workflow)])

    return (
        <MultiToggleSwitch
            containerStyle={[
                localStyles.toggleSwitch,
                mobile ? localStyles.toggleSwitchMobile : isMiddleScreen && localStyles.toggleSwitchTablet,
            ]}
            options={
                haveWorkflow
                    ? [
                          {
                              icon: 'square',
                              text: 'Open',
                              badge: openTasksAmount,
                          },
                          {
                              icon: 'workflow',
                              text: 'Workflow',
                              badge: workflowTasksAmount,
                          },
                          {
                              icon: 'square-checked-gray',
                              text: 'Done',
                              badge:
                                  earlierDoneTasksAmount > 0
                                      ? earlierDoneTasksAmount
                                      : doneTasksAmount
                                      ? doneTasksAmount
                                      : 0,
                          },
                      ]
                    : [
                          {
                              icon: 'square',
                              text: 'Open',
                              badge: openTasksAmount,
                          },
                          null,
                          {
                              icon: 'square-checked-gray',
                              text: 'Done',
                              badge:
                                  earlierDoneTasksAmount > 0
                                      ? earlierDoneTasksAmount
                                      : doneTasksAmount
                                      ? doneTasksAmount
                                      : 0,
                          },
                      ]
            }
            currentIndex={currentSectionIndex}
            onChangeOption={onChangeToggleOption}
        />
    )
}

const localStyles = {
    toggleSwitch: {
        position: 'absolute',
        right: 104,
        top: 44,
        zIndex: 10,
    },
    toggleSwitchMobile: {
        right: 16,
    },
    toggleSwitchTablet: {
        right: 56,
    },
}
