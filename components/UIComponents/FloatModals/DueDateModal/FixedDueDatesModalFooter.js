import React from 'react'
import { StyleSheet, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import DateItemSection from './DateItemSection'
import CustomDate from './CustomDate'
import AutoReminder from './AutoReminder'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'

export default function FixedDueDatesModalFooter({
    task,
    inParentGoal,
    projectId,
    closePopover,
    delayClosePopover,
    saveDueDateBeforeSaveTask,
    multipleTasks,
    tasks,
    isObservedTabActive,
    setVisibleCalendar,
    updateParentGoalReminderDate,
    showAutoReminder,
    goal,
}) {
    const lastSelectedDueDate = useSelector(state => state.lastSelectedDueDate)

    return (
        <View style={[localStyles.estimationSection, localStyles.estimationLastSection]}>
            <DateItemSection
                dateData={{
                    text: 'Last selected',
                    date:
                        lastSelectedDueDate === BACKLOG_DATE_NUMERIC
                            ? BACKLOG_DATE_NUMERIC
                            : moment(lastSelectedDueDate),
                    shortcut: 'C',
                }}
                task={task}
                delayClosePopover={delayClosePopover}
                saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                isObservedTabActive={isObservedTabActive}
                multipleTasks={multipleTasks}
                tasks={tasks}
                inParentGoal={inParentGoal}
                projectId={projectId}
                closePopover={closePopover}
                updateParentGoalReminderDate={updateParentGoalReminderDate}
            />
            <CustomDate setVisibleCalendar={setVisibleCalendar} />
            {showAutoReminder && (
                <AutoReminder
                    projectId={projectId}
                    task={task}
                    tasks={tasks}
                    isObservedTabActive={isObservedTabActive}
                    closePopover={closePopover}
                    goal={goal}
                    updateParentGoalReminderDate={updateParentGoalReminderDate}
                    inParentGoal={inParentGoal}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    estimationSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingLeft: 16,
        paddingRight: 16,
    },
    estimationLastSection: {
        paddingBottom: 8,
    },
    shortcut: {
        position: 'absolute',
        right: 0,
    },
})
