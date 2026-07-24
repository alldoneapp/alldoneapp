import React from 'react'
import { shallowEqual, useSelector } from 'react-redux'

import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import TasksHelper from './Utils/TasksHelper'

export default function TasksMultiToggleSwitchSelectedProject() {
    const isAssistant = useSelector(state => !!state.currentUser.temperature)

    const workflowInProject = useSelector(state => {
        if (state.currentUser.workflow) {
            const projectId = state.loggedUserProjects[state.selectedProjectIndex].id
            return state.currentUser.workflow[projectId]
        } else {
            return null
        }
    }, shallowEqual)
    const currentSectionIndex = useSelector(state => state.taskViewToggleIndex)
    const openTasksAmount = useSelector(state => state.openTasksAmount)
    const doneTasksAmount = useSelector(state => state.doneTasksAmount)
    const earlierDoneTasksAmount = useSelector(state => state.earlierDoneTasksAmount)
    const workflowTasksAmount = useSelector(state => state.workflowTasksAmount.amount)

    const onChangeToggleOption = (index, optionText) => {
        TasksHelper.setURLOnChangeToggleOption(index, optionText)
    }

    const haveWorkflow = workflowInProject && Object.keys(workflowInProject).length > 0

    return (
        <MultiToggleSwitch
            containerStyle={localStyles.toggleSwitch}
            options={
                isAssistant
                    ? [
                          {
                              icon: 'square',
                              text: 'Open',
                          },
                          {
                              icon: 'workflow',
                              text: 'In progress',
                              badge: openTasksAmount,
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
                    : haveWorkflow
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
        alignSelf: 'center',
    },
}
