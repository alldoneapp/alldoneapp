import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomScrollView from '../../UIControls/CustomScrollView'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidthV2, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import {
    autoReminderMultipleTasks,
    getDateToMoveTaskInAutoTeminder,
} from '../../../utils/backends/Tasks/tasksFirestore'
import {
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_NONE,
    TASK_PRIORITY_SHOULD_DO,
    getTaskPriorityLabel,
    normalizeTaskPriority,
} from '../../../utils/TaskPriority'
import { getTaskPriorityColors } from '../Utils/TaskPriorityPresentation'
import { BACKLOG_DATE_NUMERIC } from '../Utils/TasksHelper'

const PRIORITY_KEYS = [
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_SHOULD_DO,
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_NONE,
]

const INITIAL_PRIORITY_SELECTION = {
    [TASK_PRIORITY_MUST_DO]: false,
    [TASK_PRIORITY_SHOULD_DO]: false,
    [TASK_PRIORITY_COULD_DO]: false,
    [TASK_PRIORITY_DO_LATER]: true,
    [TASK_PRIORITY_NONE]: false,
}

const getTaskKey = task => `${task.projectId}:${task.id}`

const getEffectiveDueDate = (task, currentUserId) =>
    task.isObservedTask ? task?.dueDateByObserversIds?.[currentUserId] : task.dueDate

const isTodayTask = (task, currentUserId, endOfDay) => {
    if (!task || task.done || task.inDone || task.parentId) return false
    const dueDate = getEffectiveDueDate(task, currentUserId)
    return typeof dueDate === 'number' && dueDate <= endOfDay
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

export const isAutoReminderTaskSelected = (task, priorityKey, prioritySelection, taskOverrides) => {
    const taskKey = getTaskKey(task)
    return hasOwn(taskOverrides, taskKey) ? taskOverrides[taskKey] : !!prioritySelection[priorityKey]
}

export default function AutoReminderTasksModal({ projectId, closePopover }) {
    const [width, height] = useWindowSize()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const openTasksMap = useSelector(state => state.openTasksMap)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [applying, setApplying] = useState(false)
    const [prioritySelection, setPrioritySelection] = useState(INITIAL_PRIORITY_SELECTION)
    const [taskOverrides, setTaskOverrides] = useState({})
    const [expandedPriorities, setExpandedPriorities] = useState({ [TASK_PRIORITY_DO_LATER]: true })
    const inAllProjects = !projectId

    const buckets = useMemo(() => {
        const result = PRIORITY_KEYS.reduce((acc, key) => ({ ...acc, [key]: [] }), {})
        const endOfDay = moment().endOf('day').valueOf()
        const projectIds = projectId ? [projectId] : Object.keys(openTasksMap || {})

        projectIds.forEach(pid => {
            const projectTasks = openTasksMap?.[pid]
            if (!projectTasks) return
            Object.values(projectTasks).forEach(task => {
                const taskWithProject = task.projectId ? task : { ...task, projectId: pid }
                if (!isTodayTask(taskWithProject, currentUserId, endOfDay)) return
                const key = normalizeTaskPriority(taskWithProject.priority)
                if (result[key]) result[key].push(taskWithProject)
            })
        })

        PRIORITY_KEYS.forEach(key => {
            result[key].sort((a, b) => {
                if (inAllProjects && a.projectId !== b.projectId) {
                    const aIndex = loggedUserProjectsMap?.[a.projectId]?.index ?? Number.MAX_SAFE_INTEGER
                    const bIndex = loggedUserProjectsMap?.[b.projectId]?.index ?? Number.MAX_SAFE_INTEGER
                    if (aIndex !== bIndex) return aIndex - bIndex
                    return a.projectId.localeCompare(b.projectId)
                }
                return (a.sortIndex || 0) - (b.sortIndex || 0)
            })
        })
        return result
    }, [openTasksMap, projectId, currentUserId, inAllProjects, loggedUserProjectsMap])

    const counts = useMemo(() => {
        const result = { all: 0 }
        PRIORITY_KEYS.forEach(key => {
            result[key] = buckets[key].length
            result.all += buckets[key].length
        })
        return result
    }, [buckets])

    const selectedTasks = useMemo(
        () =>
            PRIORITY_KEYS.flatMap(key =>
                buckets[key].filter(task => isAutoReminderTaskSelected(task, key, prioritySelection, taskOverrides))
            ),
        [buckets, prioritySelection, taskOverrides]
    )

    const selectedCounts = useMemo(() => {
        const result = { all: selectedTasks.length }
        PRIORITY_KEYS.forEach(key => {
            result[key] = buckets[key].filter(task =>
                isAutoReminderTaskSelected(task, key, prioritySelection, taskOverrides)
            ).length
        })
        return result
    }, [buckets, prioritySelection, selectedTasks.length, taskOverrides])

    const allSelected = counts.all > 0 && selectedCounts.all === counts.all
    const allPartial = selectedCounts.all > 0 && !allSelected

    const clearOverridesForTasks = (previousOverrides, tasks) => {
        const nextOverrides = { ...previousOverrides }
        tasks.forEach(task => delete nextOverrides[getTaskKey(task)])
        return nextOverrides
    }

    const togglePriority = key => {
        const selectAll = selectedCounts[key] < counts[key]
        setPrioritySelection(previous => ({ ...previous, [key]: selectAll }))
        setTaskOverrides(previous => clearOverridesForTasks(previous, buckets[key]))
        if (selectAll) setExpandedPriorities(previous => ({ ...previous, [key]: true }))
    }

    const toggleAll = () => {
        const selectAll = !allSelected
        setPrioritySelection(previous =>
            PRIORITY_KEYS.reduce((next, key) => ({ ...next, [key]: selectAll }), { ...previous })
        )
        setTaskOverrides({})
        if (selectAll) {
            setExpandedPriorities(previous =>
                PRIORITY_KEYS.reduce((next, key) => (counts[key] > 0 ? { ...next, [key]: true } : next), {
                    ...previous,
                })
            )
        }
    }

    const toggleTask = (task, key) => {
        const taskKey = getTaskKey(task)
        setTaskOverrides(previous => {
            const defaultValue = !!prioritySelection[key]
            const currentValue = hasOwn(previous, taskKey) ? previous[taskKey] : defaultValue
            const nextValue = !currentValue
            const next = { ...previous }
            if (nextValue === defaultValue) delete next[taskKey]
            else next[taskKey] = nextValue
            return next
        })
    }

    const toggleExpanded = key => {
        setExpandedPriorities(previous => ({ ...previous, [key]: !previous[key] }))
    }

    const apply = () => {
        if (applying || selectedTasks.length === 0) return
        setApplying(true)
        autoReminderMultipleTasks(selectedTasks, currentUserId, { background: true }).catch(error => {
            console.error('AutoReminderTasksModal: failed to apply auto-reminders', error)
        })
        closePopover()
    }

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onKeyDown = event => {
            if (event.key === 'Escape' && !applying) closePopover()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [applying, closePopover])

    return (
        <View
            testID="auto-reminder-modal"
            style={[
                localStyles.container,
                applyPopoverWidthV2(isMiddleScreen, smallScreenNavigation, width),
                { maxHeight: height - MODAL_MAX_HEIGHT_GAP },
            ]}
        >
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={localStyles.header}>
                    <Text style={[styles.title7, localStyles.title]}>{translate('Auto-postpone tasks')}</Text>
                    <Text style={[styles.body2, localStyles.description]}>
                        {translate('Auto-postpone tasks description')}
                    </Text>
                </View>

                <ReminderRow
                    testID="auto-reminder-all"
                    label={translate("All today's tasks")}
                    count={counts.all}
                    checked={allSelected}
                    partial={allPartial}
                    disabled={counts.all === 0 || applying}
                    emphasized
                    onToggle={toggleAll}
                />
                <View style={localStyles.divider} />
                {PRIORITY_KEYS.map(key => {
                    const checked = counts[key] > 0 && selectedCounts[key] === counts[key]
                    const partial = selectedCounts[key] > 0 && !checked
                    const expanded = !!expandedPriorities[key]
                    return (
                        <View key={key}>
                            <ReminderRow
                                testID={`auto-reminder-priority-${key}`}
                                priorityKey={key}
                                label={translate(getTaskPriorityLabel(key))}
                                count={counts[key]}
                                checked={checked}
                                partial={partial}
                                disabled={counts[key] === 0 || applying}
                                onToggle={() => togglePriority(key)}
                                expandable={counts[key] > 0}
                                expanded={expanded}
                                onToggleExpanded={() => toggleExpanded(key)}
                            />
                            {expanded &&
                                buckets[key].map(task => (
                                    <TaskPreviewRow
                                        key={getTaskKey(task)}
                                        testID={`auto-reminder-task-${getTaskKey(task)}`}
                                        task={task}
                                        projectName={
                                            inAllProjects ? loggedUserProjectsMap?.[task.projectId]?.name : null
                                        }
                                        checked={isAutoReminderTaskSelected(
                                            task,
                                            key,
                                            prioritySelection,
                                            taskOverrides
                                        )}
                                        disabled={applying}
                                        onToggle={() => toggleTask(task, key)}
                                    />
                                ))}
                        </View>
                    )
                })}

                <View style={localStyles.buttonContainer}>
                    <View style={localStyles.buttonSpacer} />
                    <Button
                        type="secondary"
                        title={translate('Cancel')}
                        onPress={closePopover}
                        buttonStyle={{ marginRight: 8 }}
                        disabled={applying}
                    />
                    <Button
                        type="primary"
                        title={translate('Apply')}
                        onPress={apply}
                        disabled={selectedTasks.length === 0 || applying}
                    />
                </View>
            </CustomScrollView>
            <TouchableOpacity style={localStyles.closeButton} onPress={closePopover} disabled={applying}>
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

function SelectionCheckbox({ checked, partial, disabled, testID }) {
    return (
        <View
            testID={testID}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: partial ? 'mixed' : !!checked, disabled: !!disabled }}
            style={[
                localStyles.checkbox,
                (checked || partial) && localStyles.checkboxChecked,
                disabled && localStyles.checkboxDisabled,
            ]}
        >
            {checked ? (
                <Icon name="check" size={14} color="#ffffff" />
            ) : partial ? (
                <View style={localStyles.partialMark} />
            ) : null}
        </View>
    )
}

function ReminderRow({
    label,
    count,
    checked,
    partial,
    disabled,
    onToggle,
    priorityKey,
    emphasized,
    expandable,
    expanded,
    onToggleExpanded,
    testID,
}) {
    const flagColor = priorityKey ? getTaskPriorityColors(priorityKey).foregroundColor : null

    return (
        <View style={[localStyles.row, disabled && localStyles.rowDisabled]}>
            <TouchableOpacity
                testID={`${testID}-select`}
                style={localStyles.rowSelection}
                onPress={disabled ? undefined : onToggle}
                disabled={disabled}
                activeOpacity={0.7}
            >
                <SelectionCheckbox
                    testID={`${testID}-checkbox`}
                    checked={checked}
                    partial={partial}
                    disabled={disabled}
                />
                {priorityKey ? (
                    <Icon name="flag" size={16} color={flagColor} style={localStyles.flag} />
                ) : (
                    <View style={localStyles.flagPlaceholder} />
                )}
                <Text
                    style={[
                        styles.body1,
                        localStyles.rowLabel,
                        emphasized && localStyles.rowLabelEmphasized,
                        disabled && localStyles.rowLabelDisabled,
                    ]}
                    numberOfLines={1}
                >
                    {label}
                </Text>
                <Text style={[styles.body1, localStyles.rowCount, disabled && localStyles.rowLabelDisabled]}>
                    {`(${count})`}
                </Text>
            </TouchableOpacity>
            {expandable && (
                <TouchableOpacity
                    testID={`${testID}-expand`}
                    style={localStyles.expandButton}
                    onPress={disabled ? undefined : onToggleExpanded}
                    disabled={disabled}
                >
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.Text03} />
                </TouchableOpacity>
            )}
        </View>
    )
}

function TaskPreviewRow({ task, projectName, checked, disabled, onToggle, testID }) {
    const reminderDate = getDateToMoveTaskInAutoTeminder(task.timesPostponed, task.isObservedTask)
    const dateText = reminderDate === BACKLOG_DATE_NUMERIC ? translate('Someday') : reminderDate.format('D MMM')

    return (
        <TouchableOpacity
            testID={testID}
            style={[localStyles.taskRow, disabled && localStyles.rowDisabled]}
            onPress={disabled ? undefined : onToggle}
            disabled={disabled}
            activeOpacity={0.7}
        >
            <SelectionCheckbox testID={`${testID}-checkbox`} checked={checked} disabled={disabled} />
            <View style={localStyles.taskTextContainer}>
                <Text style={[styles.body1, localStyles.taskName]} numberOfLines={1}>
                    {task.name || task.extendedName || ''}
                </Text>
                {!!projectName && (
                    <Text style={[styles.caption2, localStyles.projectName]} numberOfLines={1}>
                        {projectName}
                    </Text>
                )}
            </View>
            <Text style={[styles.body2, localStyles.taskDate]}>{dateText}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'relative',
        zIndex: 9999,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        paddingBottom: 8,
    },
    header: {
        marginBottom: 8,
        paddingRight: 24,
    },
    title: {
        color: '#ffffff',
    },
    description: {
        color: colors.Text03,
        marginTop: 4,
    },
    divider: {
        height: 1,
        backgroundColor: colors.Secondary300,
        marginVertical: 4,
    },
    row: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
    },
    rowSelection: {
        minHeight: 44,
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    rowDisabled: {
        opacity: 0.4,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    checkboxDisabled: {
        borderColor: colors.Text03,
    },
    partialMark: {
        width: 10,
        height: 2,
        borderRadius: 1,
        backgroundColor: '#ffffff',
    },
    flag: {
        marginLeft: 12,
    },
    flagPlaceholder: {
        width: 16,
        marginLeft: 12,
    },
    rowLabel: {
        color: '#ffffff',
        marginLeft: 8,
        flex: 1,
    },
    rowLabelEmphasized: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    rowLabelDisabled: {
        color: colors.Text03,
    },
    rowCount: {
        color: colors.Text03,
        marginLeft: 8,
    },
    expandButton: {
        width: 36,
        height: 44,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    taskRow: {
        minHeight: 48,
        marginLeft: 32,
        paddingLeft: 16,
        paddingRight: 4,
        flexDirection: 'row',
        alignItems: 'center',
        borderLeftWidth: 1,
        borderLeftColor: colors.Secondary300,
    },
    taskTextContainer: {
        flex: 1,
        marginLeft: 12,
        marginRight: 16,
    },
    taskName: {
        color: '#ffffff',
    },
    projectName: {
        color: colors.Text03,
        marginTop: 2,
    },
    taskDate: {
        minWidth: 64,
        color: colors.Text03,
        textAlign: 'right',
    },
    buttonContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginTop: 16,
    },
    buttonSpacer: {
        flex: 1,
    },
    closeButton: {
        position: 'absolute',
        right: 8,
        top: 8,
    },
})
