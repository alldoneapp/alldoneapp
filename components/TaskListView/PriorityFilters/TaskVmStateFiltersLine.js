import React, { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import {
    getVmSessionBadgeState,
    VM_BADGE_STATE_FAILED,
    VM_BADGE_STATE_IN_PROGRESS,
    VM_BADGE_STATE_PAUSED,
    watchVmSessionStatus,
} from '../../../utils/backends/Assistants/vmSessionStatus'
import { clearTaskVmStateFilters, setTaskVmStateFilters, updateTaskVmState } from '../../../redux/actions'
import { collectTaskVmSessionRefs, collectTaskVmStateCounts } from './taskPriorityFilterHelper'

const FILTER_VM_STATES = [VM_BADGE_STATE_IN_PROGRESS, VM_BADGE_STATE_PAUSED, VM_BADGE_STATE_FAILED]

const VM_STATE_PRESENTATION = {
    [VM_BADGE_STATE_IN_PROGRESS]: { label: 'In progress', color: colors.Yellow400 },
    [VM_BADGE_STATE_PAUSED]: { label: 'Paused', color: colors.Text03 },
    [VM_BADGE_STATE_FAILED]: { label: 'Failed', color: colors.UtilityRed300 },
}

export default function TaskVmStateFiltersLine({ projectId }) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const openTasksStore = useSelector(state => state.openTasksStore)
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore)
    const taskVmStateFilters = useSelector(state => state.taskVmStateFilters, shallowEqual)
    const taskVmStatesByTask = useSelector(state => state.taskVmStatesByTask, shallowEqual)
    const subscriptionsRef = useRef(new Map())

    const instances = useMemo(() => {
        const buildInstance = pid => ({
            projectId: pid,
            sections: openTasksStore[pid + currentUserId],
            subtasksByParentId: subtaskByTaskStore[pid + currentUserId],
        })
        return projectId ? [buildInstance(projectId)] : (loggedUserProjectIds || []).map(buildInstance)
    }, [openTasksStore, subtaskByTaskStore, projectId, currentUserId, loggedUserProjectIds])

    const taskRefs = useMemo(() => collectTaskVmSessionRefs(instances), [instances])
    const { counts, total, available } = useMemo(() => collectTaskVmStateCounts(instances, taskVmStatesByTask), [
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

    useEffect(() => {
        dispatch(clearTaskVmStateFilters())
    }, [currentUserId, selectedProjectIndex])

    useEffect(() => {
        if (available === 0) dispatch(clearTaskVmStateFilters())
    }, [available])

    useEffect(() => {
        return () => {
            subscriptionsRef.current.forEach((unsubscribe, taskKey) => {
                unsubscribe()
                dispatch(updateTaskVmState(taskKey, null))
            })
            subscriptionsRef.current.clear()
            dispatch(clearTaskVmStateFilters())
        }
    }, [])

    if (available === 0) return null

    const toggleVmState = vmState => {
        const next = taskVmStateFilters.includes(vmState)
            ? taskVmStateFilters.filter(state => state !== vmState)
            : [...taskVmStateFilters, vmState]
        dispatch(setTaskVmStateFilters(next))
    }

    const isAllSelected = taskVmStateFilters.length === 0

    return (
        <View style={localStyles.container} testID="task-vm-state-filters">
            <View style={localStyles.header}>
                <Icon name="monitor" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('VM States')}</Text>
            </View>

            <View style={localStyles.chipsRow}>
                <TouchableOpacity
                    style={[localStyles.filterItem, isAllSelected && localStyles.filterItemSelected]}
                    onPress={() => dispatch(clearTaskVmStateFilters())}
                    testID="task-vm-state-filter-all"
                >
                    <Text style={[localStyles.filterName, isAllSelected && localStyles.filterNameSelected]}>
                        {translate('All')}
                    </Text>
                    <Text style={[localStyles.filterCount, isAllSelected && localStyles.filterCountSelected]}>
                        {total}
                    </Text>
                </TouchableOpacity>

                {FILTER_VM_STATES.map(vmState => {
                    const count = counts[vmState] || 0
                    const isSelected = taskVmStateFilters.includes(vmState)
                    if (count === 0 && !isSelected) return null

                    return (
                        <TouchableOpacity
                            key={vmState}
                            style={[localStyles.filterItem, isSelected && localStyles.filterItemSelected]}
                            onPress={() => toggleVmState(vmState)}
                            testID={`task-vm-state-filter-${vmState}`}
                        >
                            <View
                                style={[
                                    localStyles.colorDot,
                                    { backgroundColor: VM_STATE_PRESENTATION[vmState].color },
                                    isSelected && localStyles.colorDotSelected,
                                ]}
                            />
                            <Text style={[localStyles.filterName, isSelected && localStyles.filterNameSelected]}>
                                {translate(VM_STATE_PRESENTATION[vmState].label)}
                            </Text>
                            <Text style={[localStyles.filterCount, isSelected && localStyles.filterCountSelected]}>
                                {count}
                            </Text>
                        </TouchableOpacity>
                    )
                })}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 8,
        marginBottom: 8,
    },
    header: {
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerIcon: {
        marginRight: 6,
    },
    headerText: {
        flex: 1,
        color: colors.Text03,
        marginRight: 8,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 8,
    },
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
    filterItemSelected: {
        backgroundColor: colors.Primary200,
    },
    colorDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 6,
    },
    colorDotSelected: {
        borderWidth: 1,
        borderColor: 'white',
    },
    filterName: {
        ...styles.caption1,
        color: colors.Text03,
        marginRight: 6,
    },
    filterNameSelected: {
        color: 'white',
    },
    filterCount: {
        ...styles.caption2,
        color: colors.Text03,
    },
    filterCountSelected: {
        color: 'white',
    },
})
