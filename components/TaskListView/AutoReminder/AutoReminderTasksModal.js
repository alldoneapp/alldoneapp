import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import CustomScrollView from '../../UIControls/CustomScrollView'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import { autoReminderMultipleTasks } from '../../../utils/backends/Tasks/tasksFirestore'
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

// Priority buckets shown in the modal, ordered highest → lowest. Every today-task
// normalizes to exactly one of these, so the buckets are disjoint and their union is
// the full set of today's tasks (that's what the "All today's tasks" master toggles).
const PRIORITY_KEYS = [
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_SHOULD_DO,
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_NONE,
]

const getEffectiveDueDate = (task, currentUserId) =>
    task.isObservedTask ? task?.dueDateByObserversIds?.[currentUserId] : task.dueDate

// openTasksMap is already limited to open (not-done) tasks due today/overdue, but the
// show-later / show-someday toggles can widen it, so we re-check the effective due date
// (observer-specific for observed tasks) and skip done tasks and subtasks defensively.
const isTodayTask = (task, currentUserId, endOfDay) => {
    if (!task || task.done || task.inDone || task.parentId) return false
    const dueDate = getEffectiveDueDate(task, currentUserId)
    return typeof dueDate === 'number' && dueDate <= endOfDay
}

export default function AutoReminderTasksModal({ projectId, closePopover }) {
    const [, height] = useWindowSize()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const openTasksMap = useSelector(state => state.openTasksMap)
    const [applying, setApplying] = useState(false)
    const [selected, setSelected] = useState({
        [TASK_PRIORITY_MUST_DO]: false,
        [TASK_PRIORITY_SHOULD_DO]: false,
        [TASK_PRIORITY_COULD_DO]: false,
        [TASK_PRIORITY_DO_LATER]: true,
        [TASK_PRIORITY_NONE]: false,
    })

    // Group today's tasks by priority. projectId set → that project only; null → every
    // loaded project (the All-Projects view watches them all into openTasksMap).
    const buckets = useMemo(() => {
        const result = PRIORITY_KEYS.reduce((acc, key) => ({ ...acc, [key]: [] }), {})
        const endOfDay = moment().endOf('day').valueOf()
        const projectIds = projectId ? [projectId] : Object.keys(openTasksMap || {})
        projectIds.forEach(pid => {
            const projectTasks = openTasksMap?.[pid]
            if (!projectTasks) return
            Object.values(projectTasks).forEach(task => {
                if (!isTodayTask(task, currentUserId, endOfDay)) return
                const key = normalizeTaskPriority(task.priority)
                if (result[key]) result[key].push(task)
            })
        })
        return result
    }, [openTasksMap, projectId, currentUserId])

    const counts = useMemo(() => {
        const result = { all: 0 }
        PRIORITY_KEYS.forEach(key => {
            result[key] = buckets[key].length
            result.all += buckets[key].length
        })
        return result
    }, [buckets])

    const availableKeys = PRIORITY_KEYS.filter(key => counts[key] > 0)
    const allSelected = availableKeys.length > 0 && availableKeys.every(key => selected[key])

    const selectedTasks = useMemo(() => PRIORITY_KEYS.filter(key => selected[key]).flatMap(key => buckets[key]), [
        selected,
        buckets,
    ])

    const toggleKey = key => setSelected(prev => ({ ...prev, [key]: !prev[key] }))

    const toggleAll = () => {
        const next = !allSelected
        setSelected(prev => availableKeys.reduce((acc, key) => ({ ...acc, [key]: next }), { ...prev }))
    }

    const apply = async () => {
        if (applying || selectedTasks.length === 0) return
        setApplying(true)
        try {
            await autoReminderMultipleTasks(selectedTasks)
            closePopover()
        } finally {
            setApplying(false)
        }
    }

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onKeyDown = event => {
            if (event.key === 'Escape') closePopover()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [closePopover])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={localStyles.header}>
                    <Text style={[styles.title7, localStyles.title]}>{translate('Auto-reminder tasks')}</Text>
                    <Text style={[styles.body2, localStyles.description]}>
                        {translate('Auto-reminder tasks description')}
                    </Text>
                </View>

                <ReminderRow
                    label={translate("All today's tasks")}
                    count={counts.all}
                    checked={allSelected}
                    disabled={counts.all === 0 || applying}
                    emphasized
                    onToggle={toggleAll}
                />
                <View style={localStyles.divider} />
                {PRIORITY_KEYS.map(key => (
                    <ReminderRow
                        key={key}
                        priorityKey={key}
                        label={translate(getTaskPriorityLabel(key))}
                        count={counts[key]}
                        checked={selected[key] && counts[key] > 0}
                        disabled={counts[key] === 0 || applying}
                        onToggle={() => toggleKey(key)}
                    />
                ))}

                <View style={localStyles.buttonContainer}>
                    <View style={localStyles.buttonSpacer} />
                    <Button
                        type="secondary"
                        title={translate('Cancel')}
                        onPress={closePopover}
                        buttonStyle={{ marginRight: 8 }}
                    />
                    <Button
                        type="primary"
                        title={translate('Apply')}
                        onPress={apply}
                        disabled={selectedTasks.length === 0 || applying}
                    />
                </View>
            </CustomScrollView>
            <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

function ReminderRow({ label, count, checked, disabled, onToggle, priorityKey, emphasized }) {
    const flagColor = priorityKey ? getTaskPriorityColors(priorityKey).foregroundColor : null

    return (
        <TouchableOpacity
            style={[localStyles.row, disabled && localStyles.rowDisabled]}
            onPress={disabled ? undefined : onToggle}
            disabled={disabled}
            activeOpacity={0.7}
        >
            <View
                style={[
                    localStyles.checkbox,
                    checked && localStyles.checkboxChecked,
                    disabled && localStyles.checkboxDisabled,
                ]}
            >
                {checked && <Icon name="check" size={14} color="#ffffff" />}
            </View>
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
