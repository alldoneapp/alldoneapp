import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles from '../../../styles/global'
import moment from 'moment'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import DateText from './DateText'
import { useSelector, useDispatch } from 'react-redux'
import Backend from '../../../../utils/BackendBridge'
import { setLastSelectedDueDate, setSelectedTasks, startLoadingData, stopLoadingData } from '../../../../redux/actions'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { setTaskDueDate } from '../../../../utils/backends/Tasks/tasksFirestore'

export default function DateItemSection({
    dateData,
    task,
    delayClosePopover,
    saveDueDateBeforeSaveTask,
    isObservedTabActive,
    multipleTasks,
    tasks,
    projectId,
    closePopover,
    updateParentGoalReminderDate,
}) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const currentUser = useSelector(state => state.currentUser)

    const selectDate = dateTimestamp => {
        if (multipleTasks) {
            Backend.setTaskDueDateMultiple(tasks, dateTimestamp).then(dispatch(stopLoadingData()))
            dispatch([setSelectedTasks(null, true), startLoadingData()])
            if (updateParentGoalReminderDate) updateParentGoalReminderDate(dateTimestamp)
        } else if (updateParentGoalReminderDate) {
            updateParentGoalReminderDate(dateTimestamp)
        } else {
            setTaskDueDate(projectId, task.id, dateTimestamp, task, isObservedTabActive, null)
        }
        closePopover()
    }

    const onPress = event => {
        event.preventDefault()
        event.stopPropagation()
        const dateTimestamp = date.valueOf()
        dispatch(setLastSelectedDueDate(dateTimestamp))
        if (saveDueDateBeforeSaveTask) {
            delayClosePopover()
            saveDueDateBeforeSaveTask(dateTimestamp, isObservedTabActive)
        } else {
            selectDate(dateTimestamp)
        }
    }

    const { text, date, shortcut } = dateData
    const dueDate = moment(isObservedTabActive ? task.dueDateByObserversIds[currentUser.uid] : task.dueDate)
    const selected = text !== 'Last selected' && task.dueDate !== Number.MAX_SAFE_INTEGER && dueDate.isSame(date, 'day')

    return (
        <View>
            <Hotkeys keyName={shortcut} onKeyDown={(sht, event) => onPress(event)} filter={e => true}>
                <TouchableOpacity style={localStyles.dateSectionItem} onPress={onPress} accessible={false}>
                    <View style={localStyles.dateSectionItem}>
                        <View style={localStyles.sectionItemText}>
                            <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                {translate(text)} <DateText selected={selected} date={date} withDot={true} />
                            </Text>
                        </View>
                        <View style={localStyles.sectionItemCheck}>
                            {selected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                            {!mobile && (
                                <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} containerStyle={{ marginLeft: 4 }} />
                            )}
                        </View>
                    </View>
                </TouchableOpacity>
            </Hotkeys>
        </View>
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
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    shortcut: {
        position: 'absolute',
        right: 0,
    },
})
