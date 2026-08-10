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
    autoPostponeMultipleTasks,
    getDateToMoveTaskInAutoPostpone,
    setTaskDueDate,
    setTaskToBacklog,
} from '../../../../utils/backends/Tasks/tasksFirestore'
import { autoPostponeGoal, getDateToMoveGoalInAutoPostpone } from '../../../../utils/backends/Goals/goalsFirestore'
import {
    clearOptimisticGoalPostpone,
    setLastSelectedDueDate,
    setOptimisticGoalPostpone,
} from '../../../../redux/actions'

export default function AutoPostpone({
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

    const autoPostpone = async () => {
        if (applying) return
        setApplying(true)
        const isGoalAutoPostpone = goal && updateParentGoalReminderDate

        if (!isGoalAutoPostpone && bulkTasks) {
            autoPostponeMultipleTasks(bulkTasks, currentUserId, { background: true }).catch(error => {
                console.error('AutoPostpone: failed to apply auto-postpone', error)
            })
            closePopover()
            return
        }

        if (!isGoalAutoPostpone && singleTaskToPostpone?.id) {
            // Write directly to Firestore (like a manual due-date change) so the task moves
            // instantly via Firestore's local cache, instead of waiting on the auto-postpone
            // Cloud Function round-trip. The target date is already computed client-side below.
            const dateTimestamp = date === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : date.valueOf()
            const applyPromise =
                dateTimestamp === BACKLOG_DATE_NUMERIC
                    ? setTaskToBacklog(
                          projectId,
                          singleTaskToPostpone.id,
                          singleTaskToPostpone,
                          isObservedTabActive,
                          null
                      )
                    : setTaskDueDate(
                          projectId,
                          singleTaskToPostpone.id,
                          dateTimestamp,
                          singleTaskToPostpone,
                          isObservedTabActive
                      )
            Promise.resolve(applyPromise).catch(error => {
                console.error('AutoPostpone: failed to apply auto-postpone', error)
            })
            dispatch(setLastSelectedDueDate(dateTimestamp))
            closePopover()
            return
        }

        if (isGoalAutoPostpone) {
            const dateTimestamp = date === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : date.valueOf()
            // AT-2160: the goal postpone stays on the server — it is one transaction that also
            // records the undo entry and cascades the date onto the goal's open tasks. Drop the
            // goal out of today's list right away so the UI does not wait for that round trip;
            // a rejected postpone puts it straight back.
            dispatch(setOptimisticGoalPostpone(projectId, goal.id, dateTimestamp, Date.now()))
            autoPostponeGoal(projectId, goal, currentUserId, inParentGoal, { background: true }).catch(error => {
                dispatch(clearOptimisticGoalPostpone(projectId, goal.id))
                console.error('AutoPostpone: failed to apply auto-postpone', error)
            })
            dispatch(setLastSelectedDueDate(dateTimestamp))
            closePopover()
            return
        }

        try {
            // Draft tasks have no server object yet, so keep the calculated date local.
            const dateTimestamp = date === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : date.valueOf()
            dispatch(setLastSelectedDueDate(dateTimestamp))
            await saveDueDateBeforeSaveTask?.(dateTimestamp, isObservedTabActive)
            closePopover()
        } catch (error) {
            console.error('AutoPostpone: failed to apply auto-postpone', error)
        } finally {
            setApplying(false)
        }
    }

    // AT-2160: a "list" of exactly one task is still a single task. Routing it through the bulk
    // callable cost a Cloud Function round trip for a write the client can do itself, and that is
    // not a corner case — swiping the general-tasks header, or a goal section holding one task,
    // lands here with a one-element list.
    const bulkTasks = tasks && tasks.length > 1 ? tasks : null
    const singleTaskToPostpone = bulkTasks ? null : tasks && tasks.length === 1 ? tasks[0] : task

    // Calculate date based on goal or task
    const date = goal
        ? getDateToMoveGoalInAutoPostpone(goal.timesPostponed)
        : bulkTasks
        ? null
        : getDateToMoveTaskInAutoPostpone(singleTaskToPostpone?.timesPostponed, isObservedTabActive)

    return (
        <TouchableOpacity
            style={[localStyles.dateSectionItem, applying && localStyles.disabled]}
            onPress={autoPostpone}
            disabled={applying}
            accessible={false}
        >
            <Hotkeys key={9} keyName={'A'} onKeyDown={(sht, event) => autoPostpone(event)} filter={e => true}>
                <View style={localStyles.dateSectionItem}>
                    <View style={localStyles.sectionItemText}>
                        <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                            {translate('Auto postpone')}{' '}
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
