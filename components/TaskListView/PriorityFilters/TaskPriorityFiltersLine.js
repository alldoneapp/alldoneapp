import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector, shallowEqual } from 'react-redux'

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
import { collectTaskPriorityCounts } from './taskPriorityFilterHelper'
import AutoPostponeTasksModal from '../AutoPostpone/AutoPostponeTasksModal'
import {
    clearTaskPriorityFilters,
    hideFloatPopup,
    setTaskPriorityFilters,
    showFloatPopup,
} from '../../../redux/actions'
import { AUTO_POSTPONE_TASKS_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'

const FILTER_PRIORITY_KEYS = [
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_SHOULD_DO,
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_NONE,
]

export default function TaskPriorityFiltersLine({ projectId }) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const openTasksStore = useSelector(state => state.openTasksStore)
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore)
    const taskPriorityFilters = useSelector(state => state.taskPriorityFilters, shallowEqual)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [showAutoPostpone, setShowAutoPostpone] = useState(false)
    const closeTimeoutRef = useRef()

    const { counts, total, prioritized } = useMemo(() => {
        const buildInstance = instanceKey => ({
            sections: openTasksStore[instanceKey],
            subtasksByParentId: subtaskByTaskStore[instanceKey],
        })
        const instances = projectId
            ? [buildInstance(projectId + currentUserId)]
            : (loggedUserProjectIds || []).map(pid => buildInstance(pid + currentUserId))
        return collectTaskPriorityCounts(instances)
    }, [openTasksStore, subtaskByTaskStore, projectId, currentUserId, loggedUserProjectIds])

    const clearFilters = () => {
        dispatch(clearTaskPriorityFilters())
    }

    // A fresh view starts unfiltered, and when the last prioritized task
    // disappears the filters must not keep hiding tasks behind a hidden line.
    useEffect(() => {
        clearFilters()
    }, [currentUserId, selectedProjectIndex])

    useEffect(() => {
        if (prioritized === 0) clearFilters()
    }, [prioritized])

    useEffect(() => {
        return () => {
            if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
            dispatch(clearTaskPriorityFilters())
        }
    }, [])

    if (prioritized === 0) return null

    const togglePriority = priorityKey => {
        const next = taskPriorityFilters.includes(priorityKey)
            ? taskPriorityFilters.filter(key => key !== priorityKey)
            : [...taskPriorityFilters, priorityKey]
        dispatch(setTaskPriorityFilters(next))
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
        closeTimeoutRef.current = setTimeout(() => {
            closeAutoPostpone()
        })
    }

    const isAllSelected = taskPriorityFilters.length === 0

    return (
        <View style={localStyles.container} testID="task-priority-filters">
            <View style={localStyles.header}>
                <Icon name="flag" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('Task Priorities')}</Text>
                {showAutoPostpone ? (
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
                )}
            </View>

            <View style={localStyles.chipsRow}>
                <TouchableOpacity
                    style={[localStyles.filterItem, isAllSelected && localStyles.filterItemSelected]}
                    onPress={() => dispatch(clearTaskPriorityFilters())}
                    testID="task-priority-filter-all"
                >
                    <Text style={[localStyles.filterName, isAllSelected && localStyles.filterNameSelected]}>
                        {translate('All')}
                    </Text>
                    <Text style={[localStyles.filterCount, isAllSelected && localStyles.filterCountSelected]}>
                        {total}
                    </Text>
                </TouchableOpacity>

                {FILTER_PRIORITY_KEYS.map(priorityKey => {
                    const count = counts[priorityKey] || 0
                    const isSelected = taskPriorityFilters.includes(priorityKey)
                    if (count === 0 && !isSelected) return null

                    return (
                        <TouchableOpacity
                            key={priorityKey}
                            style={[localStyles.filterItem, isSelected && localStyles.filterItemSelected]}
                            onPress={() => togglePriority(priorityKey)}
                            testID={`task-priority-filter-${priorityKey}`}
                        >
                            <View
                                style={[
                                    localStyles.colorDot,
                                    { backgroundColor: getTaskPriorityColors(priorityKey).foregroundColor },
                                    isSelected && localStyles.colorDotSelected,
                                ]}
                            />
                            <Text style={[localStyles.filterName, isSelected && localStyles.filterNameSelected]}>
                                {translate(getTaskPriorityLabel(priorityKey))}
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

function AutoPostponeButton({ onPress, mobile }) {
    return (
        <TouchableOpacity
            style={[localStyles.autoPostponeButton, mobile && localStyles.autoPostponeButtonMobile]}
            onPress={onPress}
            testID="task-priority-auto-postpone"
            accessibilityLabel={translate('Auto-postpone based on priorities')}
        >
            <Icon name="coffee" size={12} color={colors.Text03} />
            {!mobile && (
                <Text style={[styles.caption1, localStyles.autoPostponeText, windowTagStyle()]}>
                    {translate('Auto-postpone based on priorities')}
                </Text>
            )}
        </TouchableOpacity>
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
    autoPostponeButton: {
        height: 22,
        borderRadius: 11,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: colors.Grey400,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    autoPostponeButtonMobile: {
        width: 24,
        paddingHorizontal: 0,
    },
    autoPostponeText: {
        color: colors.Text03,
        marginLeft: 4,
    },
})
