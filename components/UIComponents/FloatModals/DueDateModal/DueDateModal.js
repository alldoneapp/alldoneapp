import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import v4 from 'uuid/v4'
import moment from 'moment'

import { colors } from '../../../styles/global'
import DueDateCalendarModal from './../DueDateCalendarModal/DueDateCalendarModal'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { DUE_DATE_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { OBSERVERS_TAB, ASSIGNEE_TAB } from './TabsList'
import Header from './Header'
import FixedDueDatesModal from './FixedDueDatesModal'
import FixedDueDatesModalFooter from './FixedDueDatesModalFooter'
import DueDateCalendarModalFooter from './DueDateCalendarModalFooter'
import { useSelector } from 'react-redux'
import { translate } from '../../../../i18n/TranslationService'
import Backend from '../../../../utils/BackendBridge'
import { watchGoal } from '../../../../utils/backends/Goals/goalsFirestore'
import GoalBasedModal from './GoalBasedModal'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'

function DueDateModal({
    task,
    projectId,
    closePopover,
    delayClosePopover,
    inEditTask,
    saveDueDateBeforeSaveTask,
    multipleTasks,
    tasks,
    windowSize,
    isObservedTask,
    setToBacklogBeforeSaveTask,
    inParentGoal,
    updateParentGoalReminderDate,
    goalCompletionDate,
    goalStartingDate,
    goal,
}) {
    const currentUser = useSelector(state => state.currentUser)
    const [parentGoal, setParentGoal] = useState(null)
    const [visibleCalendar, setVisibleCalendar] = useState(false)
    const [showGoalBasedOptions, setShowGoalBasedOptions] = useState(false)
    const [activeTab, setActiveTab] = useState(isObservedTask ? OBSERVERS_TAB : ASSIGNEE_TAB)
    const [previousMilestoneDate, setPreviousMilestoneDate] = useState(moment().valueOf())
    const [parentGoalTaskList, setParentGoalTaskList] = useState(
        inParentGoal
            ? tasks.map(task => {
                  return { ...task, projectId, isObservedTask }
              })
            : []
    )

    const parentGoalId = task ? task.parentGoalId : ''

    useEffect(() => {
        if (parentGoalId) {
            const watcherKey = v4()
            watchGoal(projectId, parentGoalId, watcherKey, setParentGoal)
            return () => {
                Backend.unwatch(watcherKey)
            }
        }
    }, [parentGoalId])

    useEffect(() => {
        storeModal(DUE_DATE_MODAL_ID)
        return () => {
            removeModal(DUE_DATE_MODAL_ID)
        }
    }, [])

    useEffect(() => {
        if (inParentGoal && isObservedTask && multipleTasks) {
            const parentGoalTaskList = tasks.map(task => {
                return { ...task, projectId, isObservedTask: activeTab === OBSERVERS_TAB }
            })
            setParentGoalTaskList(parentGoalTaskList)
        }
    }, [activeTab, tasks])

    const taskList = inParentGoal ? parentGoalTaskList : tasks
    const title = visibleCalendar
        ? translate('Pick date')
        : inParentGoal
        ? translate('Goal tasks reminder')
        : translate('Select reminder')
    const description = inParentGoal
        ? translate('Select a date to postpone this goal and its tasks')
        : `${translate('Select the date to postpone the')} ${translate(updateParentGoalReminderDate ? 'goal' : 'task')}`
    const showTabs = !updateParentGoalReminderDate && isObservedTask && !visibleCalendar

    const wrappedSaveDueDate = async (date, isObserved) => {
        if (multipleTasks && tasks && tasks.length > 0) {
            if (saveDueDateBeforeSaveTask) {
                for (const t of tasks) {
                    try {
                        await saveDueDateBeforeSaveTask(t, date, isObserved)
                    } catch (error) {
                        console.error(`[DueDateModal] Error updating task ${t.id}:`, error)
                    }
                }
            } else {
                console.error('[DueDateModal] saveDueDateBeforeSaveTask is undefined for multiple task update.')
            }
            if (inParentGoal && updateParentGoalReminderDate) {
                updateParentGoalReminderDate(date)
            }
        } else if (saveDueDateBeforeSaveTask) {
            saveDueDateBeforeSaveTask(task, date, isObserved)
        } else if (updateParentGoalReminderDate) {
            updateParentGoalReminderDate(date)
        } else {
            console.error(
                '[DueDateModal] No valid update function found (saveDueDateBeforeSaveTask or updateParentGoalReminderDate).'
            )
        }
        closePopover()
    }

    const wrappedSetToBacklog = async isObserved => {
        if (multipleTasks && tasks && tasks.length > 0) {
            if (setToBacklogBeforeSaveTask) {
                for (const t of tasks) {
                    try {
                        await setToBacklogBeforeSaveTask(t, isObserved)
                    } catch (error) {
                        console.error(`[DueDateModal] Error setting task ${t.id} to backlog:`, error)
                    }
                }
            } else {
                console.error('[DueDateModal] setToBacklogBeforeSaveTask is undefined for multiple task update.')
            }
            if (inParentGoal && updateParentGoalReminderDate) {
                updateParentGoalReminderDate(BACKLOG_DATE_NUMERIC)
            }
        } else if (setToBacklogBeforeSaveTask) {
            setToBacklogBeforeSaveTask(task, isObserved)
        } else if (updateParentGoalReminderDate) {
            updateParentGoalReminderDate(BACKLOG_DATE_NUMERIC)
        } else {
            console.error(
                '[DueDateModal] No valid backlog function found (setToBacklogBeforeSaveTask or updateParentGoalReminderDate).'
            )
        }
        closePopover()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView showsVerticalScrollIndicator={false}>
                <Header
                    setActiveTab={setActiveTab}
                    activeTab={activeTab}
                    delayClosePopover={delayClosePopover}
                    title={title}
                    description={description}
                    showTabs={showTabs}
                />
                {visibleCalendar ? (
                    <View>
                        <DueDateCalendarModal
                            inParentGoal={inParentGoal}
                            task={task}
                            projectId={projectId}
                            closePopover={delayClosePopover}
                            inEditTask={inEditTask}
                            saveDueDateBeforeSaveTask={wrappedSaveDueDate}
                            multipleTasks={multipleTasks}
                            tasks={taskList}
                            isObservedTabActive={activeTab === OBSERVERS_TAB}
                            initialDate={
                                activeTab === OBSERVERS_TAB ? task.dueDateByObserversIds[currentUser.uid] : task.dueDate
                            }
                            updateParentGoalReminderDate={updateParentGoalReminderDate}
                        />
                        <View style={localStyles.sectionSeparator} />
                        <DueDateCalendarModalFooter setVisibleCalendar={setVisibleCalendar} />
                    </View>
                ) : showGoalBasedOptions ? (
                    <GoalBasedModal
                        inParentGoal={inParentGoal}
                        task={task}
                        projectId={projectId}
                        closePopover={closePopover}
                        delayClosePopover={delayClosePopover}
                        saveDueDateBeforeSaveTask={wrappedSaveDueDate}
                        multipleTasks={multipleTasks}
                        tasks={taskList}
                        isObservedTabActive={activeTab === OBSERVERS_TAB}
                        updateParentGoalReminderDate={updateParentGoalReminderDate}
                        goalCompletionDate={parentGoal ? parentGoal.completionMilestoneDate : goalCompletionDate}
                        goalStartingDate={parentGoal ? parentGoal.startingMilestoneDate : goalStartingDate}
                        setShowGoalBasedOptions={setShowGoalBasedOptions}
                        previousMilestoneDate={previousMilestoneDate}
                    />
                ) : (
                    <View>
                        <FixedDueDatesModal
                            inParentGoal={inParentGoal}
                            task={task}
                            projectId={projectId}
                            closePopover={closePopover}
                            delayClosePopover={delayClosePopover}
                            saveDueDateBeforeSaveTask={wrappedSaveDueDate}
                            multipleTasks={multipleTasks}
                            tasks={taskList}
                            isObservedTabActive={activeTab === OBSERVERS_TAB}
                            setToBacklogBeforeSaveTask={wrappedSetToBacklog}
                            updateParentGoalReminderDate={updateParentGoalReminderDate}
                            goalCompletionDate={parentGoal ? parentGoal.completionMilestoneDate : goalCompletionDate}
                            setShowGoalBasedOptions={setShowGoalBasedOptions}
                            parentGoal={parentGoal || goal}
                            setPreviousMilestoneDate={setPreviousMilestoneDate}
                        />
                        <View style={localStyles.sectionSeparator} />
                        <FixedDueDatesModalFooter
                            inParentGoal={inParentGoal}
                            task={task}
                            projectId={projectId}
                            closePopover={closePopover}
                            delayClosePopover={delayClosePopover}
                            saveDueDateBeforeSaveTask={wrappedSaveDueDate}
                            multipleTasks={multipleTasks}
                            tasks={taskList}
                            isObservedTabActive={activeTab === OBSERVERS_TAB}
                            setVisibleCalendar={setVisibleCalendar}
                            updateParentGoalReminderDate={updateParentGoalReminderDate}
                            showAutoReminder={!goal}
                        />
                    </View>
                )}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        borderRadius: 4,
        width: 305,
        overflow: 'visible',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 8,
    },
})

export default withWindowSizeHook(DueDateModal)
