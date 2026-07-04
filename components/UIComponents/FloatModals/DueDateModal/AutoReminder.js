import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'
import DateText from './DateText'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import {
    autoReminderMultipleTasks,
    autoReminderTask,
    getDateToMoveTaskInAutoTeminder,
} from '../../../../utils/backends/Tasks/tasksFirestore'
import { autoReminderGoal, getDateToMoveGoalInAutoReminder } from '../../../../utils/backends/Goals/goalsFirestore'
import { setLastSelectedDueDate } from '../../../../redux/actions'

export default function AutoReminder({
    projectId,
    task,
    tasks,
    isObservedTabActive,
    closePopover,
    goal,
    updateParentGoalReminderDate,
    inParentGoal,
    saveDueDateBeforeSaveTask,
}) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [applying, setApplying] = useState(false)

    const autoReminder = async () => {
        if (applying) return
        setApplying(true)
        try {
            if (goal && updateParentGoalReminderDate) {
                // Goal auto-reminders keep their existing cloud-backed flow.
                const dateTimestamp = await autoReminderGoal(projectId, goal, currentUserId, inParentGoal)
                dispatch(setLastSelectedDueDate(dateTimestamp))
            } else if (tasks && tasks.length > 0) {
                await autoReminderMultipleTasks(tasks, currentUserId)
            } else if (task?.id) {
                const dateTimestamp = await autoReminderTask(projectId, task, isObservedTabActive, currentUserId)
                if (dateTimestamp !== null) dispatch(setLastSelectedDueDate(dateTimestamp))
            } else {
                // Draft tasks have no server object yet, so keep the calculated date local.
                const dateTimestamp = date === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : date.valueOf()
                dispatch(setLastSelectedDueDate(dateTimestamp))
                await saveDueDateBeforeSaveTask?.(dateTimestamp, isObservedTabActive)
            }
            closePopover()
        } catch (error) {
            console.error('AutoReminder: failed to apply auto-reminder', error)
        } finally {
            setApplying(false)
        }
    }

    // Calculate date based on goal or task
    const date = goal
        ? getDateToMoveGoalInAutoReminder(goal.timesPostponed)
        : tasks
        ? null
        : getDateToMoveTaskInAutoTeminder(task.timesPostponed, isObservedTabActive)

    return (
        <TouchableOpacity
            style={[localStyles.dateSectionItem, applying && localStyles.disabled]}
            onPress={autoReminder}
            disabled={applying}
            accessible={false}
        >
            <Hotkeys key={9} keyName={'A'} onKeyDown={(sht, event) => autoReminder(event)} filter={e => true}>
                <View style={localStyles.dateSectionItem}>
                    <View style={localStyles.sectionItemText}>
                        <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                            {translate('Auto reminder')}{' '}
                            {date ? (
                                date === BACKLOG_DATE_NUMERIC ? (
                                    <Text style={[styles.body1, { color: colors.Text03 }]}>
                                        {' • '}
                                        {translate('Someday')}
                                    </Text>
                                ) : (
                                    <DateText date={date} withDot={true} />
                                )
                            ) : null}
                        </Text>
                    </View>
                    <View
                        style={[
                            localStyles.navigateIndicator,
                            localStyles.sectionItemCheck,
                            !smallScreenNavigation && { marginTop: -4 },
                        ]}
                    >
                        <Text style={[styles.body1, { color: colors.Text03 }]}>
                            {!smallScreenNavigation ? (
                                <Shortcut text={'A'} theme={SHORTCUT_LIGHT} />
                            ) : (
                                <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                            )}
                        </Text>
                    </View>
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    dateSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        justifyContent: 'flex-end',
    },
    navigateIndicator: {
        marginTop: 4,
    },
    disabled: {
        opacity: 0.5,
    },
})
