import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment-timezone'

import DateHeader from '../../Header/DateHeader'
import styles, { colors } from '../../../styles/global'
import { getTimeFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import DateTag from '../../../Tags/DateTag'
import TaskRecurrence from '../../../Tags/TaskRecurrence'
import TaskTypeTag from '../../../Tags/TaskTypeTag'
import UserTag from '../../../Tags/UserTag'
import AddPreConfigTaskWrapper from '../../../AssistantDetailedView/Customizations/PreConfigTasks/AddPreConfigTaskWrapper'
import { taskPresentationLayout } from '../../TaskItem/TaskPresentation/TaskPresentationLayout'
import { TASK_EXECUTION_MODE_DIRECT, getTaskExecutionMode } from '../../../../utils/taskExecutionMode'
import AiStepCheckBox from '../../TaskItem/TaskPresentation/CheckBoxContainer/AiStepCheckBox'
import PreConfigTaskGeneratorWrapper from './PreConfigTaskGeneratorWrapper'
import { translate } from '../../../../i18n/TranslationService'

export function AssistantScheduleRows({ projectId, tasksProjectId, assistant, occurrences, disabled = false }) {
    const timeFormat = getTimeFormat()

    return (
        <View testID="assistant-schedule-task-list">
            {occurrences.map(occurrence => {
                const time = moment.tz(occurrence.timestamp, occurrence.timezoneName)
                const timezoneAbbreviation = time.format('z')
                const timeLabel = `${time.format(timeFormat)} ${timezoneAbbreviation}`.trim()
                const recurrenceTask = { ...occurrence.task, recurrence: occurrence.recurrence }
                const executionMode = getTaskExecutionMode(occurrence.task, TASK_EXECUTION_MODE_DIRECT)

                return (
                    <AddPreConfigTaskWrapper
                        key={occurrence.id}
                        disabled={disabled}
                        projectId={tasksProjectId || projectId}
                        assistantId={assistant.uid}
                        task={occurrence.task}
                        adding={false}
                    >
                        <View style={taskPresentationLayout.container}>
                            <View
                                style={[taskPresentationLayout.taskRow, disabled && localStyles.disabledRow]}
                                testID="assistant-schedule-task-row"
                            >
                                <View
                                    style={[taskPresentationLayout.leadingContent, localStyles.scheduleLeadingContent]}
                                    testID="assistant-schedule-task-leading-content"
                                >
                                    <PreConfigTaskGeneratorWrapper
                                        projectId={projectId}
                                        task={occurrence.task}
                                        assistant={assistant}
                                        disabled={disabled}
                                        skipNavigation
                                    >
                                        {({ onPress, running, disabled: executionDisabled }) => (
                                            <TouchableOpacity
                                                style={localStyles.executionButton}
                                                onPress={onPress}
                                                disabled={executionDisabled}
                                                activeOpacity={executionDisabled ? 1 : 0.35}
                                                accessibilityLabel={translate('Run now')}
                                                title={translate('Run now')}
                                                testID="assistant-schedule-task-play-button"
                                            >
                                                <AiStepCheckBox running={running} />
                                            </TouchableOpacity>
                                        )}
                                    </PreConfigTaskGeneratorWrapper>
                                    <View style={localStyles.descriptionContainer}>
                                        <Text style={[styles.body1, localStyles.name]} numberOfLines={1}>
                                            {occurrence.task.name}
                                        </Text>
                                    </View>
                                </View>
                                <View style={localStyles.tags} testID="assistant-schedule-task-tags">
                                    <DateTag date={timeLabel} icon="clock" disabled />
                                    <TaskRecurrence
                                        task={recurrenceTask}
                                        projectId={projectId}
                                        disabled
                                        style={localStyles.tagSpacing}
                                    />
                                    {executionMode === TASK_EXECUTION_MODE_DIRECT && (
                                        <TaskTypeTag
                                            icon="fast-forward"
                                            text="Bypass workflow"
                                            containerStyle={localStyles.tagSpacing}
                                        />
                                    )}
                                    {!!occurrence.user && (
                                        <View style={localStyles.tagSpacing}>
                                            <UserTag user={occurrence.user} />
                                        </View>
                                    )}
                                    {occurrence.status === 'failed' && (
                                        <TaskTypeTag
                                            icon="alert-circle"
                                            text="Needs attention"
                                            containerStyle={localStyles.tagSpacing}
                                        />
                                    )}
                                </View>
                            </View>
                        </View>
                    </AddPreConfigTaskWrapper>
                )
            })}
        </View>
    )
}

export default function AssistantScheduleDateSection({
    projectId,
    dateKey,
    occurrences,
    firstDateSection,
    ...scheduleContext
}) {
    const isToday = dateKey === '0'
    const date = isToday ? moment() : moment(dateKey, 'YYYYMMDD')

    return (
        <View>
            <DateHeader
                dateText={isToday ? 'Today' : dateKey}
                date={date}
                isToday={isToday}
                firstDateSection={firstDateSection}
                amountTasks={occurrences.length}
                projectId={projectId}
            />
            <AssistantScheduleRows projectId={projectId} occurrences={occurrences} {...scheduleContext} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    scheduleLeadingContent: {
        alignItems: 'center',
    },
    executionButton: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    descriptionContainer: {
        flex: 1,
        minWidth: 0,
        paddingLeft: 12,
    },
    name: {
        color: colors.Text01,
        marginTop: 5,
        marginBottom: 5,
    },
    tags: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 5,
        marginBottom: 5,
        paddingRight: 8,
    },
    tagSpacing: {
        marginLeft: 8,
    },
    disabledRow: {
        opacity: 0.5,
    },
})
