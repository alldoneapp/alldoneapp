import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles from '../../../styles/global'
import Backend from '../../../../utils/BackendBridge'
import moment from 'moment'
import { setLastSelectedDueDate, setSelectedTasks, startLoadingData, stopLoadingData } from '../../../../redux/actions'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import DateItemSection from './DateItemSection'
import { useSelector, useDispatch } from 'react-redux'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import { getPreviousMilestone } from '../../../../utils/backends/Goals/goalsFirestore'
import { setTaskToBacklog } from '../../../../utils/backends/Tasks/tasksFirestore'

export default function FixedDueDatesModal({
    task,
    inParentGoal,
    projectId,
    closePopover,
    delayClosePopover,
    saveDueDateBeforeSaveTask,
    multipleTasks,
    tasks,
    isObservedTabActive,
    setToBacklogBeforeSaveTask,
    updateParentGoalReminderDate,
    goalCompletionDate,
    setShowGoalBasedOptions,
    parentGoal,
    setPreviousMilestoneDate,
}) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const sendToBacklog = event => {
        event.preventDefault()
        event.stopPropagation()

        dispatch(setLastSelectedDueDate(BACKLOG_DATE_NUMERIC))
        if (setToBacklogBeforeSaveTask) {
            delayClosePopover()
            setToBacklogBeforeSaveTask(isObservedTabActive)
        } else {
            if (multipleTasks) {
                Backend.setTaskToBacklogMultiple(tasks).then(dispatch(stopLoadingData()))
                dispatch([setSelectedTasks(null, true), startLoadingData()])
                if (updateParentGoalReminderDate) updateParentGoalReminderDate(BACKLOG_DATE_NUMERIC)
            } else if (updateParentGoalReminderDate) {
                updateParentGoalReminderDate(BACKLOG_DATE_NUMERIC)
            } else {
                setTaskToBacklog(projectId, task.id, task, isObservedTabActive, null)
            }
            closePopover()
        }
    }

    const openGoalBasedModal = event => {
        event.preventDefault()
        event.stopPropagation()
        setShowGoalBasedOptions(true)
    }

    const getNextDay = day => {
        const dateNowDay = new Date()
        const weekDay = moment().day(day)
        const nextDay = dateNowDay.getTime() >= weekDay.valueOf() ? weekDay.add(7, 'day') : weekDay
        return nextDay
    }

    const datesFirstGroup = [
        { text: 'Today', date: moment(), shortcut: '1' },
        { text: 'Tomorrow', date: moment().add(1, 'day'), shortcut: '2' },
        { text: 'This next Saturday', date: getNextDay('Saturday'), shortcut: '3' },
        { text: 'This next Monday', date: getNextDay('Monday'), shortcut: '4' },
    ]

    const showThirdGroup = goalCompletionDate && goalCompletionDate !== BACKLOG_DATE_NUMERIC

    const datesSecondGroup = [
        { text: 'In 2 days', date: moment().add(2, 'day'), shortcut: '5' },
        { text: 'In 4 days', date: moment().add(4, 'day'), shortcut: '6' },
        { text: 'In 7 days', date: moment().add(7, 'day'), shortcut: '7' },
        { text: 'In 30 days', date: moment().add(30, 'day'), shortcut: '8' },
    ]

    const getPreviousMilestoneDate = async () => {
        const milestone = await getPreviousMilestone(projectId, parentGoal.ownerId, parentGoal.completionMilestoneDate)
        setPreviousMilestoneDate(milestone ? moment(milestone.date).add(1, 'day').valueOf() : moment().valueOf())
    }

    useEffect(() => {
        if (parentGoal) getPreviousMilestoneDate()
    }, [showThirdGroup, parentGoal])

    return (
        <View>
            <View style={localStyles.estimationSection}>
                {datesFirstGroup.map(dateData => {
                    return (
                        <DateItemSection
                            inParentGoal={inParentGoal}
                            key={dateData.text}
                            dateData={dateData}
                            task={task}
                            delayClosePopover={delayClosePopover}
                            saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                            isObservedTabActive={isObservedTabActive}
                            multipleTasks={multipleTasks}
                            tasks={tasks}
                            projectId={projectId}
                            closePopover={closePopover}
                            updateParentGoalReminderDate={updateParentGoalReminderDate}
                        />
                    )
                })}
            </View>

            <>
                <View style={localStyles.sectionSeparator} />
                <View style={localStyles.estimationSection}>
                    {datesSecondGroup.map(dateData => {
                        return (
                            <DateItemSection
                                inParentGoal={inParentGoal}
                                key={dateData.text}
                                dateData={dateData}
                                task={task}
                                delayClosePopover={delayClosePopover}
                                saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                                isObservedTabActive={isObservedTabActive}
                                multipleTasks={multipleTasks}
                                tasks={tasks}
                                projectId={projectId}
                                closePopover={closePopover}
                                updateParentGoalReminderDate={updateParentGoalReminderDate}
                            />
                        )
                    })}
                </View>
            </>

            {showThirdGroup && (
                <>
                    <View style={localStyles.sectionSeparator} />
                    <View style={localStyles.estimationSection}>
                        <Hotkeys keyName={'G'} onKeyDown={(sht, event) => openGoalBasedModal(event)} filter={e => true}>
                            <TouchableOpacity
                                style={localStyles.dateSectionItem}
                                onPress={openGoalBasedModal}
                                accessible={false}
                            >
                                <View style={localStyles.dateSectionItem}>
                                    <View style={localStyles.sectionItemText}>
                                        <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                            {translate('Goal based')}
                                        </Text>
                                    </View>
                                    <View style={localStyles.sectionItemCheck}>
                                        {!smallScreenNavigation && <Shortcut text={'G'} theme={SHORTCUT_LIGHT} />}
                                    </View>
                                </View>
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>
                </>
            )}

            <View style={localStyles.sectionSeparator} />

            <View style={localStyles.estimationSection}>
                <Hotkeys keyName={'9'} onKeyDown={(sht, event) => sendToBacklog(event)} filter={e => true}>
                    <TouchableOpacity style={localStyles.dateSectionItem} onPress={sendToBacklog} accessible={false}>
                        <View style={localStyles.dateSectionItem}>
                            <View style={localStyles.sectionItemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{translate('Someday')}</Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {!smallScreenNavigation && <Shortcut text={'9'} theme={SHORTCUT_LIGHT} />}
                            </View>
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    estimationSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingLeft: 16,
        paddingRight: 16,
    },
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
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 8,
    },
})
