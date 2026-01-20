import React from 'react'
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
    getDateToMoveTaskInAutoTeminder,
    setTaskDueDate,
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
}) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const autoReminder = async () => {
        if (goal && updateParentGoalReminderDate) {
            // Auto-remind goal and cascade to tasks
            const dateTimestamp = await autoReminderGoal(projectId, goal, currentUserId, inParentGoal)
            dispatch(setLastSelectedDueDate(dateTimestamp))
        } else if (tasks) {
            autoReminderMultipleTasks(tasks)
        } else {
            const dateTimestamp = date === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : date.valueOf()
            dispatch(setLastSelectedDueDate(dateTimestamp))
            setTaskDueDate(projectId, task.id, dateTimestamp, task, isObservedTabActive, null)
        }
        closePopover()
    }

    // Calculate date based on goal or task
    const date = goal
        ? getDateToMoveGoalInAutoReminder(goal.timesPostponed)
        : tasks
        ? null
        : getDateToMoveTaskInAutoTeminder(task.timesPostponed, isObservedTabActive)

    return (
        <TouchableOpacity style={localStyles.dateSectionItem} onPress={autoReminder} accessible={false}>
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
})
