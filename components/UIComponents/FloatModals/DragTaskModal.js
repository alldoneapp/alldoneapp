import React, { useEffect, useState } from 'react'
import { Image, Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../../Icon'
import global, { colors } from '../../styles/global'
import {
    removeActiveDragTaskModeInDate,
    setSelectedTasks,
    showConfirmPopup,
    showFloatPopup,
    clearTasksIdsWithSubtasksExpandedWhenActiveDragTaskMode,
    updateAllSelectedTasks,
} from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'
import DueDateModal from './DueDateModal/DueDateModal'
import EstimationModal from './EstimationModal/EstimationModal'
import { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from '../ConfirmPopup'
import DistributeModal from './DistributeModal'
import Spinner from '../Spinner'
import Popover from 'react-tiny-popover'
import AssigneePickerModal from './AssigneePickerModal/AssigneePickerModal'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import Button from '../../UIControls/Button'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import TaskParentGoalModal from './TaskParentGoalModal/TaskParentGoalModal'
import DragTaskModalMoreButtonWrapper from './DragTaskModalMoreButtonModal/DragTaskModalMoreButtonWrapper'
import { PRIVACY_MODAL_ID } from '../../ModalsManager/modalsManager'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import { getTaskAutoEstimation, OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import {
    setTaskAssigneeMultiple,
    setTaskAutoEstimationMultiple,
    setTaskHighlightMultiple,
    setTaskDueDate,
    setTaskToBacklog,
} from '../../../utils/backends/Tasks/tasksFirestore'
import { setFutureEstimationsMultiple } from '../../../utils/backends/firestore'

const DragTaskModal = ({ projectId: currentProjectIdFromProp }) => {
    const dispatch = useDispatch()
    const openModals = useSelector(state => state.openModals)
    const tasks = useSelector(state => state.selectedTasks)
    const [flag, setFlag] = useState('#FFFFFF')
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUser = useSelector(state => state.currentUser)
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const [showReminder, setShowReminder] = useState(false)
    const [showEstimation, setShowEstimation] = useState(false)
    const [showParentGoal, setShowParentGoal] = useState(false)
    const [activeGoal, setActiveGoal] = useState(null)
    const [showDistribute, setShowDistribute] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [showAssigneePopover, setShowAssigneePopover] = useState(false)
    const [openMoreOptions, setOpenMoreOptions] = useState(false)

    useEffect(() => {
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    })

    const onKeyDown = event => {
        if (!openMoreOptions) {
            const { key } = event
            if (key === 'Escape' && tasks.length === 0) {
                dispatch(removeActiveDragTaskModeInDate())
            } else if (key === 'Escape' && !showEstimation && !showReminder) {
                dispatch(setSelectedTasks(null, true))
            }
        }
    }

    const closeDragMode = () => {
        dispatch(removeActiveDragTaskModeInDate())
        dispatch(setSelectedTasks(null, true))
    }

    useEffect(() => {
        return () => {
            dispatch(clearTasksIdsWithSubtasksExpandedWhenActiveDragTaskMode())
        }
    }, [])

    useEffect(() => {
        setFlag(checkEqual())
    }, [tasks])

    const checkEqual = () => {
        return tasks.length > 0 && tasks.filter(i => i.hasStar === tasks[0].hasStar).length === tasks.length
            ? tasks[0].hasStar
            : '#FFFFFF'
    }

    const setHighlight = highlightColor => {
        setIsLoading(true)
        const filteredTasks = tasks.filter(i => i.hasStar !== highlightColor)
        setTaskHighlightMultiple(highlightColor, filteredTasks).then(() => setIsLoading(false))
        for (let i = 0; i < tasks.length; i++) {
            tasks[i].hasStar = highlightColor
        }
        setFlag(highlightColor)
    }

    const askToDeleteTask = () => {
        Keyboard.dismiss()

        dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                object: { multiTasks: true, tasks },
            }),
        ])
    }

    function compare(a, b) {
        if (a.dueDate > b.dueDate) return -1
        if (a.dueDate < b.dueDate) return 1
        return 0
    }

    const hidePopover = () => {
        setShowReminder(false)
        setShowDistribute(false)
        setShowAssigneePopover(false)
        setShowEstimation(false)
        if (!openModals[PRIVACY_MODAL_ID]) setShowParentGoal(false)
    }

    const onSelectUser = user => {
        setIsLoading(true)
        setTaskAssigneeMultiple(tasks, currentUser, user).then(() => {
            setIsLoading(false)
            setShowAssigneePopover(false)
            dispatch(setSelectedTasks(null, true))
        })
    }

    const onPressDueDateButton = () => {
        showDistribute && setShowDistribute(false)
        showEstimation && setShowEstimation(false)
        showAssigneePopover && setShowAssigneePopover(false)
        showParentGoal && setShowParentGoal(false)
        setShowReminder(!showReminder)
    }

    const onPressDistributeButton = () => {
        showReminder && setShowReminder(false)
        showEstimation && setShowEstimation(false)
        showAssigneePopover && setShowAssigneePopover(false)
        showParentGoal && setShowParentGoal(false)
        setShowDistribute(!showDistribute)
    }

    const onPressEstimationButton = () => {
        showReminder && setShowReminder(false)
        showDistribute && setShowDistribute(false)
        showAssigneePopover && setShowAssigneePopover(false)
        showParentGoal && setShowParentGoal(false)
        setShowEstimation(!showEstimation)
    }

    const onPressParentGoalButton = () => {
        showReminder && setShowReminder(false)
        showDistribute && setShowDistribute(false)
        showAssigneePopover && setShowAssigneePopover(false)
        showEstimation && setShowEstimation(false)
        if (!showParentGoal) {
            let allTasksAreInTheSameGoal = true
            const firstTask = tasks[0]
            const taskGoalId = firstTask.parentGoalId
            const parentGoalIsPublicFor = firstTask.parentGoalIsPublicFor

            if (
                parentGoalIsPublicFor &&
                !parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) &&
                !parentGoalIsPublicFor.includes(loggedUser.uid)
            ) {
                allTasksAreInTheSameGoal = false
            } else {
                for (let i = 0; i < tasks.length; i++) {
                    if (tasks[i].parentGoalId !== taskGoalId) {
                        allTasksAreInTheSameGoal = false
                        break
                    }
                }
            }
            if (allTasksAreInTheSameGoal) {
                Backend.getGoalData(firstTask.projectId, taskGoalId).then(goal => {
                    setActiveGoal(goal)
                    setShowParentGoal(true)
                })
            } else {
                setActiveGoal(null)
                setShowParentGoal(true)
            }
        } else {
            setActiveGoal(null)
            setShowParentGoal(false)
        }
    }

    const onPressAssigneeButton = () => {
        showReminder && setShowReminder(false)
        showEstimation && setShowEstimation(false)
        showDistribute && setShowDistribute(false)
        showParentGoal && setShowParentGoal(false)
        setShowAssigneePopover(!showAssigneePopover)
    }

    const onPressDeleteButton = () => {
        showReminder && setShowReminder(false)
        showDistribute && setShowDistribute(false)
        showAssigneePopover && setShowAssigneePopover(false)
        showEstimation && setShowEstimation(false)
        showParentGoal && setShowParentGoal(false)
        askToDeleteTask()
    }

    const setEstimation = estimation => {
        setFutureEstimationsMultiple(tasks, estimation)
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimationMultiple(tasks, autoEstimation)

        const updatedTasks = []
        tasks.forEach(task => {
            updatedTasks.push({ ...task, autoEstimation })
        })

        dispatch(updateAllSelectedTasks(updatedTasks))
    }

    const getAutoEstimationState = () => {
        const isThereASubtask = tasks.some(task => task.isSubtask)
        if (isThereASubtask) return { autoEstimation: null, showAutoEstimation: false }

        const inAutoModeTasks = tasks.filter(
            task => getTaskAutoEstimation(task.projectId, task.estimations[OPEN_STEP], task.autoEstimation) === true
        )
        const allTasksInAutoMode = inAutoModeTasks.length === tasks.length
        if (allTasksInAutoMode) return { autoEstimation: true, showAutoEstimation: true }

        const inManualModeTasks = tasks.filter(
            task => getTaskAutoEstimation(task.projectId, task.estimations[OPEN_STEP], task.autoEstimation) === false
        )
        const allTasksInManualMode = inManualModeTasks.length === tasks.length
        if (allTasksInManualMode) return { autoEstimation: false, showAutoEstimation: true }

        return { autoEstimation: null, showAutoEstimation: true }
    }

    const { autoEstimation, showAutoEstimation } = getAutoEstimationState()

    const anyTaskIsAssignedToAnAssistant = tasks.some(task => task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE)

    const handleSaveTaskDateInDragModal = async (taskToUpdate, dateTimestamp, isObservedTabActive) => {
        console.log(`[DragTaskModal] handleSaveTaskDateInDragModal called for task ${taskToUpdate.id}`)
        await setTaskDueDate(taskToUpdate.projectId, taskToUpdate.id, dateTimestamp, taskToUpdate, false, null)
    }

    const handleSetTaskToBacklogInDragModal = async (taskToUpdate, isObservedTabActive) => {
        console.log(`[DragTaskModal] handleSetTaskToBacklogInDragModal called for task ${taskToUpdate.id}`)
        await setTaskToBacklog(taskToUpdate.projectId, taskToUpdate.id, taskToUpdate, false, null)
    }

    return (
        <>
            {isLoading && (
                <View style={localStyles.spinner}>
                    <Spinner containerSize={48} spinnerSize={32} />
                </View>
            )}

            <View style={localStyles.container}>
                {tasks.length !== 0 && !smallScreen && (
                    <View style={localStyles.indicator}>
                        <Text style={[global.subtitle2, { color: 'white' }]}>{tasks.length}</Text>
                    </View>
                )}
                <Popover
                    content={
                        <DueDateModal
                            task={tasks && tasks.length > 0 ? tasks[0] : {}}
                            projectId={tasks && tasks.length > 0 ? tasks[0].projectId : currentProjectIdFromProp}
                            closePopover={() => setShowReminder(false)}
                            delayClosePopover={() => setShowReminder(false)}
                            multipleTasks={tasks && tasks.length > 1}
                            tasks={tasks ? tasks.sort(compare) : []}
                            setIsLoading={setIsLoading}
                            saveDueDateBeforeSaveTask={handleSaveTaskDateInDragModal}
                            setToBacklogBeforeSaveTask={handleSetTaskToBacklogInDragModal}
                        />
                    }
                    onClickOutside={hidePopover}
                    isOpen={showReminder}
                    position={['top', 'left', 'right', 'bottom']}
                    padding={mobile ? 20 : 12}
                    align={'center'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button
                        icon={'calendar'}
                        title={smallScreen ? null : 'Reminder'}
                        iconColor={'#ffffff'}
                        buttonStyle={{
                            backgroundColor: smallScreen ? 'transparent' : colors.Secondary200,
                            opacity: tasks.length === 0 ? 0.5 : 1,
                            marginRight: 8,
                        }}
                        onPress={onPressDueDateButton}
                        disabled={tasks.length === 0}
                    />
                </Popover>

                <Popover
                    content={
                        <DistributeModal
                            closePopover={() => setShowDistribute(false)}
                            tasks={tasks}
                            setIsLoading={setIsLoading}
                        />
                    }
                    onClickOutside={hidePopover}
                    isOpen={showDistribute}
                    position={['top', 'left', 'right', 'bottom']}
                    padding={mobile ? 20 : 12}
                    align={'center'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button
                        icon={'distribute'}
                        title={smallScreen ? null : 'Distribute'}
                        iconColor={'#ffffff'}
                        buttonStyle={{
                            backgroundColor: smallScreen ? 'transparent' : colors.Secondary200,
                            opacity: tasks.length === 0 ? 0.5 : 1,
                            marginRight: 8,
                        }}
                        onPress={onPressDistributeButton}
                        disabled={tasks.length === 0}
                    />
                </Popover>

                {!anyTaskIsAssignedToAnAssistant && (
                    <Popover
                        content={
                            <TaskParentGoalModal
                                key={showParentGoal}
                                activeGoal={activeGoal}
                                setActiveGoal={goal => {
                                    Backend.setTaskParentGoalMultiple(tasks, goal ? goal : null)
                                }}
                                projectId={tasks[0] ? tasks[0].projectId : null}
                                closeModal={() => setShowParentGoal(false)}
                            />
                        }
                        onClickOutside={hidePopover}
                        isOpen={showParentGoal}
                        position={['bottom', 'left', 'right', 'top']}
                        padding={mobile ? 20 : 12}
                        align={'end'}
                        contentLocation={mobile ? null : undefined}
                    >
                        <Button
                            icon={'target'}
                            title={smallScreen ? null : 'Parent goal'}
                            iconColor={'#ffffff'}
                            buttonStyle={{
                                backgroundColor: smallScreen ? 'transparent' : colors.Secondary200,
                                opacity: tasks.length === 0 ? 0.5 : 1,
                                marginRight: 8,
                            }}
                            onPress={onPressParentGoalButton}
                            disabled={tasks.length === 0}
                        />
                    </Popover>
                )}

                {!anyTaskIsAssignedToAnAssistant && (
                    <Popover
                        content={
                            <EstimationModal
                                projectId={currentProjectIdFromProp}
                                setEstimationFn={setEstimation}
                                closePopover={() => {
                                    setShowEstimation(false)
                                }}
                                autoEstimation={autoEstimation}
                                setAutoEstimation={setAutoEstimation}
                                showAutoEstimation={showAutoEstimation}
                            />
                        }
                        onClickOutside={hidePopover}
                        isOpen={showEstimation}
                        position={['top', 'left', 'right', 'bottom']}
                        padding={mobile ? 20 : 12}
                        align={'center'}
                        contentLocation={mobile ? null : undefined}
                    >
                        <Button
                            icon={'count-circle-0'}
                            title={smallScreen ? null : 'Estimation'}
                            iconColor={'#ffffff'}
                            buttonStyle={{
                                backgroundColor: smallScreen ? 'transparent' : colors.Secondary200,
                                opacity: tasks.length === 0 ? 0.5 : 1,
                                marginRight: 8,
                            }}
                            onPress={onPressEstimationButton}
                            disabled={tasks.length === 0}
                        />
                    </Popover>
                )}

                {checkIfSelectedProject(selectedProjectIndex) && !anyTaskIsAssignedToAnAssistant && (
                    <Popover
                        content={
                            <AssigneePickerModal
                                projectIndex={tasks.length > 0 && ProjectHelper.getProjectIndexById(tasks[0].projectId)}
                                task={tasks.length > 0 && tasks[0]}
                                closePopover={() => setShowAssigneePopover(false)}
                                delayClosePopover={() => setShowAssigneePopover(false)}
                                onSelectUser={onSelectUser}
                            />
                        }
                        onClickOutside={hidePopover}
                        isOpen={showAssigneePopover}
                        position={['top', 'left', 'right', 'bottom']}
                        padding={mobile ? 20 : 12}
                        align={'center'}
                        contentLocation={mobile ? null : undefined}
                    >
                        <Button
                            icon={
                                currentUser.uid.startsWith(WORKSTREAM_ID_PREFIX) ? (
                                    <Icon size={24} name="workstream" color={'#ffffff'} />
                                ) : (
                                    <Image
                                        source={{ uri: currentUser.photoURL }}
                                        style={{ width: 24, height: 24, borderRadius: 100 }}
                                    />
                                )
                            }
                            title={smallScreen ? null : 'Assignee'}
                            iconColor={'#ffffff'}
                            buttonStyle={{
                                backgroundColor: smallScreen ? 'transparent' : colors.Secondary200,
                                opacity: tasks.length === 0 ? 0.5 : 1,
                                marginRight: 8,
                            }}
                            onPress={onPressAssigneeButton}
                            disabled={tasks.length === 0}
                        />
                    </Popover>
                )}

                <DragTaskModalMoreButtonWrapper
                    selectedColor={flag}
                    onPressDeleteButton={onPressDeleteButton}
                    disabled={tasks.length === 0}
                    setHighlight={setHighlight}
                    openMoreOptions={openMoreOptions}
                    setOpenMoreOptions={setOpenMoreOptions}
                />

                <TouchableOpacity style={localStyles.buttonX} onPress={closeDragMode}>
                    <Icon name="x" color={colors.Text03} size={24} />
                </TouchableOpacity>
            </View>
        </>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Secondary400,
        paddingHorizontal: 8,
        paddingVertical: 8,
        height: 56,
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${24}px rgba(0,0,0,0.04), ${0}px ${8}px ${16}px rgba(0,0,0,0.04)`,
            },
        }),
        position: 'absolute',
        bottom: 24,
        alignItems: 'center',
        marginLeft: 'auto',
        marginRight: 'auto',
        left: 0,
        right: 0,
        width: 'fit-content',
    },
    mobileButton: {
        flexDirection: 'row',
        marginLeft: 20,
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: 0.5,
        color: '#FFFFFF',
        marginLeft: 12,
    },
    buttonX: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        alignContent: 'center',
        marginLeft: 8,
    },
    indicator: {
        backgroundColor: colors.Primary200,
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    spinner: {
        position: 'absolute',
        bottom: 56,
        right: 56,
        zIndex: 10000,
    },
})

export default DragTaskModal
