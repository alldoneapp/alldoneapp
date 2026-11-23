import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import Icon from '../../Icon'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { clearTaskPriorityFilters, setTaskPriorityFilters } from '../../../redux/actions'
import { TASK_PRIORITY_COULD_DO, TASK_PRIORITY_MUST_DO, TASK_PRIORITY_SHOULD_DO } from '../../../utils/TaskPriority'
import { formatPlanDuration, isPlanTodayTask } from '../../../utils/dailyPlan/dailyPlanModel'
import {
    getLocalPlanDateKey,
    undoDailyPlan,
    watchDailyPlan,
    watchDailyPlanUndoStatus,
} from '../../../utils/backends/Tasks/dailyPlan'
import DailyPlanModal from './DailyPlanModal'
import { planStyles as s } from './dailyPlanStyles'

// "Focused Today" is the existing priority filter: after Apply the planned tasks are exactly the
// Must/Should/Could ones (the rest was postponed, or set to Do later when it stays). The list stays
// the normal project-grouped Today, with its own filter chips to switch back.
export const PLAN_FILTER = [TASK_PRIORITY_MUST_DO, TASK_PRIORITY_SHOULD_DO, TASK_PRIORITY_COULD_DO]

/**
 * Planned tasks still open on Today, per project, as a stable string so the selector only
 * re-renders this pill when a count changes (never subscribe to the whole openTasksMap).
 */
export const getOpenPlannedKey = (openTasksMap, planned, userId, endOfDay) => {
    if (!Array.isArray(planned) || planned.length === 0) return ''
    const left = {}
    planned.forEach(item => {
        const [projectId, taskId] = item.key.split(':')
        const task = openTasksMap?.[projectId]?.[taskId]
        left[projectId] = (left[projectId] || 0) + (task && isPlanTodayTask(task, userId, endOfDay) ? 1 : 0)
    })
    return Object.keys(left)
        .sort()
        .map(projectId => `${projectId}=${left[projectId]}`)
        .join('|')
}

const parseOpenPlannedKey = key =>
    Object.fromEntries(
        (key ? key.split('|') : []).map(part => {
            const [projectId, count] = part.split('=')
            return [projectId, Number(count) || 0]
        })
    )

export const summarizeAppliedPlan = (plan, leftByProject, projectOrder = []) => {
    const rank = new Map(projectOrder.map((projectId, index) => [projectId, index]))
    const byProject = {}
    ;(plan?.planned || []).forEach(item => {
        const entry = byProject[item.projectId] || { projectId: item.projectId, count: 0, minutes: 0 }
        entry.count++
        entry.minutes += Number(item.minutes) || 0
        byProject[item.projectId] = entry
    })
    const projects = Object.values(byProject)
        .map(entry => ({ ...entry, left: leftByProject[entry.projectId] || 0 }))
        .sort(
            (a, b) =>
                (rank.get(a.projectId) ?? Number.MAX_SAFE_INTEGER) -
                    (rank.get(b.projectId) ?? Number.MAX_SAFE_INTEGER) || a.projectId.localeCompare(b.projectId)
        )
    return {
        projects,
        count: projects.reduce((total, project) => total + project.count, 0),
        minutes: projects.reduce((total, project) => total + project.minutes, 0),
        left: projects.reduce((total, project) => total + project.left, 0),
    }
}

export default function DailyPlanEntry({ meetingView }) {
    const dispatch = useDispatch()
    const userId = useSelector(state => state.loggedUser.uid)
    const projectOrder = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const filters = useSelector(state => state.taskPriorityFilters, shallowEqual)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dateKey = getLocalPlanDateKey()

    const [open, setOpen] = useState(false)
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [plan, setPlan] = useState(null)
    const [undoStatus, setUndoStatus] = useState(null)
    const [message, setMessage] = useState('')
    const [undoing, setUndoing] = useState(false)

    useEffect(() => {
        if (!userId || !meetingView) return undefined
        setPlan(null)
        return watchDailyPlan(userId, dateKey, setPlan)
    }, [userId, dateKey, !!meetingView])

    const actionId = plan?.actionId || null
    useEffect(() => {
        setUndoStatus(null)
        if (!userId || !actionId) return undefined
        return watchDailyPlanUndoStatus(userId, actionId, setUndoStatus)
    }, [userId, actionId])

    const openPlannedKey = useSelector(state =>
        plan ? getOpenPlannedKey(state.openTasksMap, plan.planned, userId, moment().endOf('day').valueOf()) : ''
    )
    const applied = useMemo(
        () => (plan ? summarizeAppliedPlan(plan, parseOpenPlannedKey(openPlannedKey), projectOrder || []) : null),
        [plan, openPlannedKey, projectOrder]
    )

    // The assistant profile board and anonymous sessions get no view (useMeetingTimeToday).
    if (!meetingView) return null

    const planActive = !!plan && (!actionId || undoStatus === 'applied')
    const showingPlan = PLAN_FILTER.every(key => filters.includes(key)) && filters.length === PLAN_FILTER.length

    const onApplied = result => {
        setMessage(
            result?.skipped?.length ? translate('dailyPlan applied with skipped', { count: result.skipped.length }) : ''
        )
        dispatch(setTaskPriorityFilters(PLAN_FILTER))
    }

    const undo = () => {
        if (!actionId || undoing) return
        setUndoing(true)
        undoDailyPlan(actionId)
            .then(result => {
                dispatch(clearTaskPriorityFilters())
                setPopoverOpen(false)
                setMessage(
                    result?.skippedOperationCount
                        ? translate('dailyPlan undo kept edited', { count: result.skippedOperationCount })
                        : ''
                )
            })
            .catch(error =>
                setMessage(
                    error?.code === 'offline' ? translate('dailyPlan offline') : translate('Could not reverse action')
                )
            )
            .finally(() => setUndoing(false))
    }

    const popoverContent = applied && (
        <View dataSet={{ adPopup: 'true' }} style={[s.card, { width: 320, padding: 16 }]} testID="daily-plan-summary">
            <Text style={s.title}>{translate('dailyPlan todays plan')}</Text>
            <Text style={[s.subtitle, { marginBottom: 8 }]}>
                {translate('dailyPlan applied summary', {
                    count: applied.count,
                    duration: formatPlanDuration(applied.minutes),
                    left: applied.left,
                })}
            </Text>
            {applied.projects.map(project => (
                <View key={project.projectId} style={s.tableRow} testID={`daily-plan-summary-${project.projectId}`}>
                    <View
                        style={[
                            s.projectDot,
                            !!loggedUserProjectsMap?.[project.projectId]?.color && {
                                backgroundColor: loggedUserProjectsMap[project.projectId].color,
                            },
                        ]}
                    />
                    <Text style={s.tableName} numberOfLines={1}>
                        {loggedUserProjectsMap?.[project.projectId]?.name || ''}
                    </Text>
                    <Text style={[s.tableCell, { width: 96 }]}>
                        {translate('dailyPlan project left', { left: project.left, count: project.count })}
                    </Text>
                    <Text style={s.tableCell}>{formatPlanDuration(project.minutes)}</Text>
                </View>
            ))}
            <View style={s.chipRow}>
                <TouchableOpacity
                    testID="daily-plan-toggle-filter"
                    style={s.chip}
                    onPress={() =>
                        dispatch(showingPlan ? clearTaskPriorityFilters() : setTaskPriorityFilters(PLAN_FILTER))
                    }
                >
                    <Text style={s.chipText}>
                        {showingPlan ? translate('dailyPlan show all tasks') : translate('dailyPlan show only plan')}
                    </Text>
                </TouchableOpacity>
                {!!actionId && (
                    <TouchableOpacity testID="daily-plan-undo" style={s.chip} onPress={undo} disabled={undoing}>
                        <Text style={s.chipText}>{undoing ? '…' : translate('dailyPlan undo plan')}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    testID="daily-plan-replan"
                    style={s.chip}
                    onPress={() => {
                        setPopoverOpen(false)
                        setOpen(true)
                    }}
                >
                    <Text style={s.chipText}>{translate('dailyPlan plan again')}</Text>
                </TouchableOpacity>
            </View>
            {!!message && <Text style={[s.mutedText, { marginTop: 8 }]}>{message}</Text>}
        </View>
    )

    return (
        <View style={[localStyles.container, mobile && localStyles.mobile]}>
            {planActive && applied ? (
                <AppPopover
                    content={popoverContent}
                    isOpen={popoverOpen}
                    onClickOutside={() => setPopoverOpen(false)}
                    position={['bottom', 'left', 'right', 'top']}
                    align="end"
                    padding={4}
                >
                    <TouchableOpacity
                        testID="daily-plan-pill"
                        style={[localStyles.button, localStyles.pill]}
                        onPress={() => setPopoverOpen(value => !value)}
                    >
                        <Icon name="sun" size={14} color={colors.Primary100} />
                        <Text style={localStyles.pillText} numberOfLines={1}>
                            {translate('dailyPlan pill', { left: applied.left, count: applied.count })}
                        </Text>
                    </TouchableOpacity>
                </AppPopover>
            ) : (
                <TouchableOpacity testID="daily-plan-open" style={localStyles.button} onPress={() => setOpen(true)}>
                    <Icon name="sun" size={14} color={colors.Primary100} />
                    <Text style={localStyles.buttonText} numberOfLines={1}>
                        {translate('dailyPlan plan my day')}
                    </Text>
                </TouchableOpacity>
            )}
            {!!message && !popoverOpen && (
                <Text style={localStyles.message} numberOfLines={2} testID="daily-plan-message">
                    {message}
                </Text>
            )}
            <DailyPlanModal
                visible={open}
                onClose={() => setOpen(false)}
                meetingView={meetingView}
                onApplied={onApplied}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 12,
        flexShrink: 0,
    },
    mobile: {
        marginLeft: 0,
        marginTop: 4,
        flexShrink: 1,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.Primary100,
    },
    pill: {
        backgroundColor: colors.Surface,
    },
    buttonText: {
        ...styles.caption1,
        color: colors.Primary100,
        marginLeft: 6,
    },
    pillText: {
        ...styles.caption1,
        color: colors.Text01,
        marginLeft: 6,
    },
    message: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
        maxWidth: 240,
    },
})
