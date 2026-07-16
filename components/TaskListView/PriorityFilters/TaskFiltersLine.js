import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import styles, { colors, windowTagStyle } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import {
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_NONE,
    TASK_PRIORITY_SHOULD_DO,
    getTaskPriorityLabel,
} from '../../../utils/TaskPriority'
import { getTaskPriorityColors } from '../Utils/TaskPriorityPresentation'
import {
    getVmSessionBadgeState,
    VM_BADGE_STATE_FAILED,
    VM_BADGE_STATE_IN_PROGRESS,
    VM_BADGE_STATE_PAUSED,
    watchVmSessionStatus,
} from '../../../utils/backends/Assistants/vmSessionStatus'
import {
    clearTaskPriorityFilters,
    clearTaskVmStateFilters,
    hideFloatPopup,
    setTaskPriorityFilters,
    setTaskVmStateFilters,
    showFloatPopup,
    updateTaskVmState,
} from '../../../redux/actions'
import {
    collectTaskPriorityCounts,
    collectTaskVmSessionRefs,
    collectTaskVmStateCounts,
} from './taskPriorityFilterHelper'
import AutoPostponeTasksModal from '../AutoPostpone/AutoPostponeTasksModal'
import { AUTO_POSTPONE_TASKS_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'

const FILTER_PRIORITY_KEYS = [
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_SHOULD_DO,
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_NONE,
]
const FILTER_VM_STATES = [VM_BADGE_STATE_IN_PROGRESS, VM_BADGE_STATE_PAUSED, VM_BADGE_STATE_FAILED]
const VM_STATE_PRESENTATION = {
    [VM_BADGE_STATE_IN_PROGRESS]: { label: 'In progress', color: colors.Yellow400 },
    [VM_BADGE_STATE_PAUSED]: { label: 'Paused', color: colors.Text03 },
    [VM_BADGE_STATE_FAILED]: { label: 'Failed', color: colors.UtilityRed300 },
}

export default function TaskFiltersLine({ projectId }) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const openTasksStore = useSelector(state => state.openTasksStore)
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore)
    const taskPriorityFilters = useSelector(state => state.taskPriorityFilters, shallowEqual)
    const taskVmStateFilters = useSelector(state => state.taskVmStateFilters, shallowEqual)
    const taskVmStatesByTask = useSelector(state => state.taskVmStatesByTask, shallowEqual)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [showAutoPostpone, setShowAutoPostpone] = useState(false)
    const closeTimeoutRef = useRef()
    const subscriptionsRef = useRef(new Map())

    const instances = useMemo(() => {
        const buildInstance = pid => ({
            projectId: pid,
            sections: openTasksStore[pid + currentUserId],
            subtasksByParentId: subtaskByTaskStore[pid + currentUserId],
        })
        return projectId ? [buildInstance(projectId)] : (loggedUserProjectIds || []).map(buildInstance)
    }, [openTasksStore, subtaskByTaskStore, projectId, currentUserId, loggedUserProjectIds])

    const priorityData = useMemo(() => collectTaskPriorityCounts(instances), [instances])
    const taskRefs = useMemo(() => collectTaskVmSessionRefs(instances), [instances])
    const vmStateData = useMemo(() => collectTaskVmStateCounts(instances, taskVmStatesByTask), [
        instances,
        taskVmStatesByTask,
    ])

    useEffect(() => {
        const wantedRefs = new Map(taskRefs.map(taskRef => [taskRef.key, taskRef]))
        subscriptionsRef.current.forEach((unsubscribe, taskKey) => {
            if (!wantedRefs.has(taskKey)) {
                unsubscribe()
                subscriptionsRef.current.delete(taskKey)
                dispatch(updateTaskVmState(taskKey, null))
            }
        })
        wantedRefs.forEach(taskRef => {
            if (subscriptionsRef.current.has(taskRef.key)) return
            const unsubscribe = watchVmSessionStatus(taskRef.projectId, taskRef.taskId, session => {
                dispatch(updateTaskVmState(taskRef.key, getVmSessionBadgeState(session)))
            })
            subscriptionsRef.current.set(taskRef.key, unsubscribe)
        })
    }, [taskRefs])

    const clearAllFilters = () => {
        dispatch(clearTaskPriorityFilters())
        dispatch(clearTaskVmStateFilters())
    }

    useEffect(() => {
        clearAllFilters()
    }, [currentUserId, selectedProjectIndex])

    useEffect(() => {
        if (priorityData.prioritized === 0) dispatch(clearTaskPriorityFilters())
    }, [priorityData.prioritized])

    useEffect(() => {
        if (vmStateData.available === 0) dispatch(clearTaskVmStateFilters())
    }, [vmStateData.available])

    useEffect(() => {
        return () => {
            if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
            subscriptionsRef.current.forEach((unsubscribe, taskKey) => {
                unsubscribe()
                dispatch(updateTaskVmState(taskKey, null))
            })
            subscriptionsRef.current.clear()
            clearAllFilters()
        }
    }, [])

    if (priorityData.prioritized === 0 && vmStateData.available === 0) return null

    const togglePriority = priorityKey => {
        const next = taskPriorityFilters.includes(priorityKey)
            ? taskPriorityFilters.filter(key => key !== priorityKey)
            : [...taskPriorityFilters, priorityKey]
        dispatch(setTaskPriorityFilters(next))
    }
    const toggleVmState = vmState => {
        const next = taskVmStateFilters.includes(vmState)
            ? taskVmStateFilters.filter(state => state !== vmState)
            : [...taskVmStateFilters, vmState]
        dispatch(setTaskVmStateFilters(next))
    }
    const openAutoPostpone = () => {
        storeModal(AUTO_POSTPONE_TASKS_MODAL_ID)
        dispatch(showFloatPopup())
        setShowAutoPostpone(true)
    }
    const closeAutoPostpone = () => {
        removeModal(AUTO_POSTPONE_TASKS_MODAL_ID)
        dispatch(hideFloatPopup())
        setShowAutoPostpone(false)
    }
    const delayCloseAutoPostpone = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        closeTimeoutRef.current = setTimeout(closeAutoPostpone)
    }

    const activeFilterCount = taskPriorityFilters.length + taskVmStateFilters.length
    const total = Math.max(priorityData.total, vmStateData.total)

    return (
        <View style={localStyles.container} testID="task-filters">
            <View style={localStyles.header}>
                <Icon name="filter" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('Task Filters')}</Text>
                {activeFilterCount > 0 && (
                    <View style={localStyles.activeCount} testID="task-filter-active-count">
                        <Text style={localStyles.activeCountText}>{activeFilterCount}</Text>
                    </View>
                )}
                {priorityData.prioritized > 0 &&
                    (showAutoPostpone ? (
                        <Popover
                            content={
                                <AutoPostponeTasksModal
                                    projectId={projectId}
                                    closePopover={closeAutoPostpone}
                                    initialSelectedPriorities={taskPriorityFilters}
                                />
                            }
                            align={'start'}
                            position={['bottom', 'right', 'left', 'top']}
                            isOpen={true}
                            contentLocation={smallScreenNavigation ? null : undefined}
                            padding={0}
                            onClickOutside={delayCloseAutoPostpone}
                        >
                            <AutoPostponeButton onPress={delayCloseAutoPostpone} mobile={smallScreenNavigation} />
                        </Popover>
                    ) : (
                        <AutoPostponeButton onPress={openAutoPostpone} mobile={smallScreenNavigation} />
                    ))}
            </View>

            <ScrollView
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={localStyles.filtersRow}
                style={localStyles.filtersScroll}
                testID="task-filters-horizontal-scroll"
            >
                <FilterChip
                    selected={activeFilterCount === 0}
                    onPress={clearAllFilters}
                    testID="task-filter-all"
                    label={translate('All')}
                    count={total}
                />

                {priorityData.prioritized > 0 && (
                    <FilterGroup label={translate('Priority')} testID="task-filter-priority-group">
                        {FILTER_PRIORITY_KEYS.map(priorityKey => {
                            const count = priorityData.counts[priorityKey] || 0
                            const selected = taskPriorityFilters.includes(priorityKey)
                            if (count === 0 && !selected) return null
                            return (
                                <FilterChip
                                    key={priorityKey}
                                    selected={selected}
                                    onPress={() => togglePriority(priorityKey)}
                                    testID={`task-priority-filter-${priorityKey}`}
                                    label={translate(getTaskPriorityLabel(priorityKey))}
                                    count={count}
                                    color={getTaskPriorityColors(priorityKey).foregroundColor}
                                />
                            )
                        })}
                    </FilterGroup>
                )}

                {vmStateData.available > 0 && (
                    <FilterGroup label={translate('VM States')} testID="task-filter-vm-state-group">
                        {FILTER_VM_STATES.map(vmState => {
                            const count = vmStateData.counts[vmState] || 0
                            const selected = taskVmStateFilters.includes(vmState)
                            if (count === 0 && !selected) return null
                            return (
                                <FilterChip
                                    key={vmState}
                                    selected={selected}
                                    onPress={() => toggleVmState(vmState)}
                                    testID={`task-vm-state-filter-${vmState}`}
                                    label={translate(VM_STATE_PRESENTATION[vmState].label)}
                                    count={count}
                                    color={VM_STATE_PRESENTATION[vmState].color}
                                />
                            )
                        })}
                    </FilterGroup>
                )}
            </ScrollView>
        </View>
    )
}

function FilterGroup({ label, testID, children }) {
    return (
        <View style={localStyles.group} testID={testID}>
            <Text style={localStyles.groupLabel}>{label}</Text>
            {children}
        </View>
    )
}

function FilterChip({ selected, onPress, testID, label, count, color }) {
    return (
        <TouchableOpacity
            style={[localStyles.filterItem, selected && localStyles.filterItemSelected]}
            onPress={onPress}
            testID={testID}
        >
            {color && (
                <View
                    style={[localStyles.colorDot, { backgroundColor: color }, selected && localStyles.colorDotSelected]}
                />
            )}
            <Text style={[localStyles.filterName, selected && localStyles.filterNameSelected]}>{label}</Text>
            <Text style={[localStyles.filterCount, selected && localStyles.filterCountSelected]}>{count}</Text>
        </TouchableOpacity>
    )
}

function AutoPostponeButton({ onPress, mobile }) {
    return (
        <TouchableOpacity
            style={[localStyles.autoPostponeButton, mobile && localStyles.autoPostponeButtonMobile]}
            onPress={onPress}
            testID="task-filter-auto-postpone"
            accessibilityLabel={translate('Auto-postpone based on priorities')}
        >
            {mobile ? (
                <Icon name="coffee" size={12} color={colors.Text03} />
            ) : (
                <>
                    <Icon name="coffee" size={12} color={colors.Text03} style={localStyles.autoPostponeIcon} />
                    <Text style={[styles.caption1, localStyles.autoPostponeText, windowTagStyle()]}>
                        {translate('Auto-postpone based on priorities')}
                    </Text>
                </>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: { marginTop: 8, marginBottom: 8 },
    header: { minHeight: 24, flexDirection: 'row', alignItems: 'center' },
    headerIcon: { marginRight: 6 },
    headerText: { flex: 1, color: colors.Text03, marginRight: 8 },
    activeCount: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Primary200,
        marginRight: 8,
    },
    activeCountText: { ...styles.caption2, color: 'white' },
    filtersScroll: { marginTop: 8 },
    filtersRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
    group: { flexDirection: 'row', alignItems: 'center' },
    groupLabel: { ...styles.caption2, color: colors.Text03, marginRight: 8, marginBottom: 8 },
    filterItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginRight: 8,
        marginBottom: 8,
    },
    filterItemSelected: { backgroundColor: colors.Primary200 },
    colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
    colorDotSelected: { borderWidth: 1, borderColor: 'white' },
    filterName: { ...styles.caption1, color: colors.Text03, marginRight: 6 },
    filterNameSelected: { color: 'white' },
    filterCount: { ...styles.caption2, color: colors.Text03 },
    filterCountSelected: { color: 'white' },
    autoPostponeButton: {
        height: 22,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    autoPostponeButtonMobile: { width: 24, paddingHorizontal: 0 },
    autoPostponeText: { color: colors.Text03 },
    autoPostponeIcon: { marginRight: 4 },
})
