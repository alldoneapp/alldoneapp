import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector, shallowEqual } from 'react-redux'

import styles, { colors } from '../../styles/global'
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
            <TouchableOpacity
                style={[localStyles.filterItem, isAllSelected && localStyles.filterItemSelected]}
                onPress={() => dispatch(clearTaskPriorityFilters())}
                testID="task-priority-filter-all"
            >
                <Text style={[localStyles.filterName, isAllSelected && localStyles.filterNameSelected]}>
                    {translate('All')}
                </Text>
                <Text style={[localStyles.filterCount, isAllSelected && localStyles.filterCountSelected]}>{total}</Text>
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

            <View style={localStyles.autoPostponeContainer}>
                {showAutoPostpone ? (
                    <Popover
                        content={
                            <AutoPostponeTasksModal
                                projectId={projectId}
                                closePopover={closeAutoPostpone}
                                initialSelectedPriorities={taskPriorityFilters}
                            />
                        }
                        align={'end'}
                        position={['bottom', 'left', 'right', 'top']}
                        isOpen={true}
                        contentLocation={smallScreenNavigation ? null : undefined}
                        padding={0}
                        onClickOutside={delayCloseAutoPostpone}
                    >
                        <AutoPostponeButton onPress={delayCloseAutoPostpone} />
                    </Popover>
                ) : (
                    <AutoPostponeButton onPress={openAutoPostpone} />
                )}
            </View>
        </View>
    )
}

function AutoPostponeButton({ onPress }) {
    return (
        <TouchableOpacity style={localStyles.autoPostponeButton} onPress={onPress} testID="task-priority-auto-postpone">
            <Icon name="coffee" size={14} color={colors.Primary300} style={{ marginRight: 6 }} />
            <Text style={localStyles.autoPostponeText}>{translate('Auto-postpone tasks')}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 8,
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
    autoPostponeContainer: {
        marginLeft: 'auto',
        marginBottom: 8,
    },
    autoPostponeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: colors.Primary300,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 3,
    },
    autoPostponeText: {
        ...styles.caption1,
        color: colors.Primary300,
    },
})
