import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import DateItemSection from './DateItemSection'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'

export default function GoalBasedModal({
    task,
    inParentGoal,
    projectId,
    closePopover,
    delayClosePopover,
    saveDueDateBeforeSaveTask,
    multipleTasks,
    tasks,
    isObservedTabActive,
    updateParentGoalReminderDate,
    goalCompletionDate,
    goalStartingDate,
    setShowGoalBasedOptions,
    previousMilestoneDate,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const datesThirdGroup = [
        {
            text: 'After previous milestone',
            date: moment(previousMilestoneDate),
            shortcut: 'P',
        },
        {
            text: '7 days before completion date',
            date: moment(goalCompletionDate).subtract(7, 'day'),
            shortcut: 'Q',
        },
        {
            text: '14 days before completion date',
            date: moment(goalCompletionDate).subtract(14, 'day'),
            shortcut: 'W',
        },
        {
            text: '30 days before completion date',
            date: moment(goalCompletionDate).subtract(30, 'day'),
            shortcut: 'E',
        },
        {
            text: 'Starting date of goal',
            date: moment(goalStartingDate),
            shortcut: 'R',
        },
        {
            text: 'Completion date of goal',
            date: moment(goalCompletionDate),
            shortcut: 'T',
        },
    ]

    const colseGoalBasedModal = event => {
        event.preventDefault()
        event.stopPropagation()
        setShowGoalBasedOptions(false)
    }

    return (
        <View>
            <View style={localStyles.estimationSection}>
                {datesThirdGroup.map(dateData => {
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
            <View style={localStyles.sectionSeparator} />
            <View style={localStyles.backButton}>
                <Hotkeys keyName={'B'} onKeyDown={(sht, event) => colseGoalBasedModal(event)} filter={e => true}>
                    <TouchableOpacity
                        style={localStyles.dateSectionItem}
                        onPress={colseGoalBasedModal}
                        accessible={false}
                    >
                        <View style={localStyles.dateSectionItem}>
                            <Icon name="chevron-left" size={24} color={colors.Text03} />
                            <View style={localStyles.sectionItemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{translate('Back')}</Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {!smallScreenNavigation && <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />}
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
    backButton: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
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
