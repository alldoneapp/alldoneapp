import React, { useRef, useEffect, useState } from 'react'
import moment from 'moment'
import v4 from 'uuid/v4'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import DismissibleItem from '../../UIComponents/DismissibleItem'
import store from '../../../redux/store'
import { BACKLOG_DATE_STRING } from '../Utils/TasksHelper'
import { isInputsFocused } from '../../../utils/HelperFunctions'
import AddTask from '../AddTask'
import Backend from '../../../utils/BackendBridge'
import { DATE_TASK_INDEX, TODAY_DATE } from '../../../utils/backends/openTasks'
import EditTask from '../TaskItem/EditTask'
import { setAddTaskSectionToOpenData } from '../../../redux/actions'

export default function NewTaskSection({
    projectId,
    hideItemFutureTasks,
    originalParentGoal,
    hideParentGoalButton,
    instanceKey,
    dateIndex,
    expandTasksList,
    isLocked,
}) {
    const dispatch = useDispatch()
    const dateFormated = useSelector(
        state => state.filteredOpenTasksStore[instanceKey]?.[dateIndex]?.[DATE_TASK_INDEX] || TODAY_DATE
    )
    const addTaskSectionToOpenData = useSelector(state => state.addTaskSectionToOpenData)
    const newItemRef = useRef(null)
    const [activeGoal, setActiveGoal] = useState(null)
    const activeGoalIdRef = useRef(null)

    const dateIsToday = dateFormated === TODAY_DATE
    const date = dateIsToday ? moment() : moment(dateFormated, 'YYYYMMDD')

    const onKeyDown = e => {
        if (store.getState().blockShortcuts || isLocked) {
            return
        }
        const { lastAddNewTaskDate } = store.getState()
        const { projectId: lastPId, date: lastAddDate } = lastAddNewTaskDate
            ? lastAddNewTaskDate
            : { projectId: null, date: null }

        const shouldOpen =
            (lastAddDate == null && projectId === lastPId && date.isSame(moment(), 'day')) ||
            (lastAddDate != null && projectId === lastPId && date.isSame(moment(lastAddDate), 'day'))

        const dismissItems = document.querySelectorAll('[aria-label="dismissible-edit-item"]')
        if (e.key === '+' && dismissItems.length === 0 && !isInputsFocused() && shouldOpen) {
            e.preventDefault()
            e.stopPropagation()
            newItemRef.current.toggleModal()
        }
    }

    const updateActiveGoal = goal => {
        activeGoalIdRef.current = goal ? goal.id : null
        setActiveGoal(goal)
    }

    useEffect(() => {
        if (originalParentGoal && (!activeGoal || originalParentGoal.id === activeGoal.id)) {
            updateActiveGoal(originalParentGoal)
        }
    }, [originalParentGoal])

    useEffect(() => {
        if (activeGoalIdRef.current && (!originalParentGoal || originalParentGoal.id !== activeGoalIdRef.current)) {
            const watcherKey = v4()
            const oldActiveGoalId = activeGoalIdRef.current
            Backend.watchGoal(projectId, activeGoalIdRef.current, watcherKey, goal => {
                if (oldActiveGoalId === activeGoalIdRef.current) {
                    updateActiveGoal(goal)
                }
            })
            return () => {
                Backend.unwatch(projectId, watcherKey)
            }
        }
    }, [activeGoalIdRef.current])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    const processAutoOpenWhenSelectGoal = addTaskSectionToOpenData => {
        const { projectId: projectIdToOpen, goalId, dateFormated: dateFormatedToOpen } = addTaskSectionToOpenData

        if (projectId === projectIdToOpen && dateFormatedToOpen === dateFormated) {
            dispatch(setAddTaskSectionToOpenData(null))
            const inputIsOpen = newItemRef.current.modalIsVisible()
            if (goalId) {
                if (originalParentGoal && goalId === originalParentGoal.id) {
                    if (!inputIsOpen) newItemRef.current.openModal(true)
                }
            } else {
                if (!originalParentGoal) {
                    if (!inputIsOpen) newItemRef.current.openModal(true)
                }
            }
        }
    }

    useEffect(() => {
        if (addTaskSectionToOpenData) processAutoOpenWhenSelectGoal(addTaskSectionToOpenData)
    }, [addTaskSectionToOpenData])

    return (
        <View style={localStyles.container}>
            <DismissibleItem
                ref={newItemRef}
                defaultComponent={
                    !hideItemFutureTasks && (
                        <AddTask
                            projectId={projectId}
                            tags={[]}
                            toggleModal={() => {
                                newItemRef?.current?.toggleModal()
                            }}
                            newItem={true}
                            activeGoal={activeGoal}
                            hideParentGoalButton={hideParentGoalButton}
                            isLocked={isLocked}
                            dateFormated={dateFormated}
                        />
                    )
                }
                modalComponent={
                    <EditTask
                        adding={true}
                        projectId={projectId}
                        onCancelAction={forceAction => {
                            newItemRef?.current?.toggleModal(forceAction)
                        }}
                        defaultDate={date.valueOf()}
                        inBacklog={dateFormated === BACKLOG_DATE_STRING}
                        originalParentGoal={originalParentGoal}
                        activeGoal={activeGoal}
                        expandTasksList={expandTasksList}
                        dateFormated={dateFormated}
                    />
                }
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
})
