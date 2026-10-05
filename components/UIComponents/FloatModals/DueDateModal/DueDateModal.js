import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import v4 from 'uuid/v4'
import moment from 'moment'

import { colors } from '../../../styles/global'
import DueDateCalendarModal from './../DueDateCalendarModal/DueDateCalendarModal'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
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
import { applyPostponeToGoalTaskList } from './applyPostponeToGoalTaskList'
import { postponeGoalWithMotion } from '../../../TaskListView/OpenTasksView/goalPostponeMotion'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

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
    animateGoalPostpone = false,
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

    const runGoalPostpone = (targetDate, write) => {
        const operation =
            animateGoalPostpone && goal
                ? postponeGoalWithMotion({ projectId, goal, targetDate }, write)
                : Promise.resolve().then(write)
        // Date rows do not await their callback. Handle a rejected bulk write here so it cannot
        // become an unhandled promise; the motion wrapper has already restored the section.
        return operation.catch(error => {
            console.error('[DueDateModal] Error postponing goal:', error)
            return null
        })
    }

    const wrappedSaveDueDate = (date, isObserved) => {
        const write = async () => {
            if (multipleTasks && tasks && tasks.length > 0) {
                if (!saveDueDateBeforeSaveTask) {
                    console.error('[DueDateModal] saveDueDateBeforeSaveTask is undefined for multiple task update.')
                }
                // AT-2160: goal row first, then all task writes together — see applyPostponeToGoalTaskList.
                return applyPostponeToGoalTaskList({
                    tasks,
                    updateGoalReminderDate:
                        inParentGoal && updateParentGoalReminderDate ? () => updateParentGoalReminderDate(date) : null,
                    applyToTask: saveDueDateBeforeSaveTask ? t => saveDueDateBeforeSaveTask(t, date, isObserved) : null,
                    onTaskError: (t, error) => console.error(`[DueDateModal] Error updating task ${t.id}:`, error),
                    rejectOnError: animateGoalPostpone,
                })
            } else if (saveDueDateBeforeSaveTask) {
                return saveDueDateBeforeSaveTask(task, date, isObserved)
            } else if (updateParentGoalReminderDate) {
                return updateParentGoalReminderDate(date)
            } else {
                console.error(
                    '[DueDateModal] No valid update function found (saveDueDateBeforeSaveTask or updateParentGoalReminderDate).'
                )
            }
        }

        const operation = runGoalPostpone(date, write)
        closePopover()
        return operation
    }

    const wrappedSetToBacklog = isObserved => {
        const write = async () => {
            if (multipleTasks && tasks && tasks.length > 0) {
                if (!setToBacklogBeforeSaveTask) {
                    console.error('[DueDateModal] setToBacklogBeforeSaveTask is undefined for multiple task update.')
                }
                // AT-2160: same shape as wrappedSaveDueDate above — goal first, tasks together.
                return applyPostponeToGoalTaskList({
                    tasks,
                    updateGoalReminderDate:
                        inParentGoal && updateParentGoalReminderDate
                            ? () => updateParentGoalReminderDate(BACKLOG_DATE_NUMERIC)
                            : null,
                    applyToTask: setToBacklogBeforeSaveTask ? t => setToBacklogBeforeSaveTask(t, isObserved) : null,
                    onTaskError: (t, error) =>
                        console.error(`[DueDateModal] Error setting task ${t.id} to backlog:`, error),
                    rejectOnError: animateGoalPostpone,
                })
            } else if (setToBacklogBeforeSaveTask) {
                return setToBacklogBeforeSaveTask(task, isObserved)
            } else if (updateParentGoalReminderDate) {
                return updateParentGoalReminderDate(BACKLOG_DATE_NUMERIC)
            } else {
                console.error(
                    '[DueDateModal] No valid backlog function found (setToBacklogBeforeSaveTask or updateParentGoalReminderDate).'
                )
            }
        }

        const operation = runGoalPostpone(BACKLOG_DATE_NUMERIC, write)
        closePopover()
        return operation
    }

    return (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                { maxHeight: getSafeAreaModalMaxHeight(windowSize[1]) },
            ]}
        >
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
                            showAutoPostpone={true}
                            goal={goal}
                            animateGoalPostpone={animateGoalPostpone}
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
        overflow: 'visible',
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
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
