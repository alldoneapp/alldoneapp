import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import moment from 'moment-timezone'
import { useSelector } from 'react-redux'

import DateHeader from '../../Header/DateHeader'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { getTimeFormat } from '../../../UIComponents/FloatModals/DateFormatPickerModal'
import DateTag from '../../../Tags/DateTag'
import TaskRecurrence from '../../../Tags/TaskRecurrence'
import TaskTypeTag from '../../../Tags/TaskTypeTag'
import UserTag from '../../../Tags/UserTag'
import TaskSummarizeTags from '../../../Tags/TaskSummarizeTags'
import AddPreConfigTaskWrapper from '../../../AssistantDetailedView/Customizations/PreConfigTasks/AddPreConfigTaskWrapper'
import { taskPresentationLayout } from '../../TaskItem/TaskPresentation/TaskPresentationLayout'
import { TASK_EXECUTION_MODE_DIRECT, getTaskExecutionMode } from '../../../../utils/taskExecutionMode'
import { doTrailingTagsCrowdTaskTitle, shouldSummarizeTaskTags } from '../../TagsArea/taskTagSummaryHelper'

function AssistantScheduleRow({ projectId, tasksProjectId, assistant, occurrence, disabled }) {
    const tablet = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const smallScreenNavSidebarCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const [visible, setVisible] = useState(false)
    const [taskItemWidth, setTaskItemWidth] = useState(0)
    const [taskTagsWidth, setTaskTagsWidth] = useState(0)

    const time = moment.tz(occurrence.timestamp, occurrence.timezoneName)
    const timezoneAbbreviation = time.format('z')
    const timeLabel = `${time.format(getTimeFormat())} ${timezoneAbbreviation}`.trim()
    const recurrenceTask = { ...occurrence.task, recurrence: occurrence.recurrence }
    const executionMode = getTaskExecutionMode(occurrence.task, TASK_EXECUTION_MODE_DIRECT)
    const tagElements = [
        { key: 'time', element: <DateTag date={timeLabel} icon="clock" disabled /> },
        {
            key: 'recurrence',
            element: <TaskRecurrence task={recurrenceTask} projectId={projectId} disabled />,
        },
        executionMode === TASK_EXECUTION_MODE_DIRECT
            ? {
                  key: 'bypass-workflow',
                  element: <TaskTypeTag icon="fast-forward" text="Bypass workflow" />,
              }
            : null,
        occurrence.user ? { key: 'user', element: <UserTag user={occurrence.user} /> } : null,
        occurrence.status === 'failed'
            ? {
                  key: 'needs-attention',
                  element: <TaskTypeTag icon="alert-circle" text="Needs attention" />,
              }
            : null,
    ].filter(Boolean)

    const trailingTagsCrowdTitle = doTrailingTagsCrowdTaskTitle({
        taskTagsWidth,
        taskItemWidth,
        taskTitleIsMultiline: false,
        inMyDayAndNotSubtask: false,
    })
    const isMobile = smallScreenNavigation || smallScreenNavSidebarCollapsed
    const needSummarize = shouldSummarizeTaskTags({
        amountTags: tagElements.length,
        inMyDayAndNotSubtask: false,
        showSummarizeTagInByTime: false,
        isCalendarTask: false,
        hasPriorityTag: false,
        trailingTagsCrowdTitle,
        tablet,
        isMobile,
    })

    useEffect(() => {
        if (!needSummarize) setVisible(false)
    }, [needSummarize])

    const toggleVisibleTags = event => {
        event.preventDefault()
        event.stopPropagation()
        setVisible(currentVisible => !currentVisible)
    }

    const renderTags = expanded =>
        tagElements.map((tag, index) => (
            <View
                key={tag.key}
                testID={`assistant-schedule-task-tag-${tag.key}`}
                style={[index > 0 && localStyles.tagSpacing, expanded && localStyles.expandedTag]}
            >
                {tag.element}
            </View>
        ))

    return (
        <AddPreConfigTaskWrapper
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
                    onLayout={event => setTaskItemWidth(event.nativeEvent.layout.width)}
                >
                    <View
                        style={[taskPresentationLayout.leadingContent, localStyles.scheduleLeadingContent]}
                        testID="assistant-schedule-task-leading-content"
                    >
                        <View style={localStyles.scheduleIcon} testID="assistant-schedule-task-icon">
                            <Icon
                                name={occurrence.status === 'failed' ? 'alert-circle' : 'clock'}
                                size={20}
                                color={occurrence.status === 'failed' ? colors.UtilityRed200 : colors.Text03}
                            />
                        </View>
                        <View style={localStyles.descriptionContainer}>
                            <Text style={[styles.body1, localStyles.name]} numberOfLines={1}>
                                {occurrence.task.name}
                            </Text>
                        </View>
                    </View>
                    <View
                        style={localStyles.tags}
                        testID="assistant-schedule-task-tags"
                        onLayout={needSummarize ? undefined : event => setTaskTagsWidth(event.nativeEvent.layout.width)}
                    >
                        {needSummarize ? (
                            <TaskSummarizeTags amountTags={tagElements.length} onPress={toggleVisibleTags} />
                        ) : (
                            renderTags(false)
                        )}
                    </View>
                </View>
                {needSummarize && visible && (
                    <View
                        style={[localStyles.expandedTags, disabled && localStyles.disabledRow]}
                        testID="assistant-schedule-task-expanded-tags"
                    >
                        {renderTags(true)}
                    </View>
                )}
            </View>
        </AddPreConfigTaskWrapper>
    )
}

/*
 * Scheduled rows use the same tag limits and width-overflow rule as regular tasks. The row component
 * owns its expansion state so an expanded tag list can wrap below the title at every screen size.
 */
export function AssistantScheduleRows({ projectId, tasksProjectId, assistant, occurrences, disabled = false }) {
    return (
        <View testID="assistant-schedule-task-list">
            {occurrences.map(occurrence => (
                <AssistantScheduleRow
                    key={occurrence.id}
                    projectId={projectId}
                    tasksProjectId={tasksProjectId}
                    assistant={assistant}
                    occurrence={occurrence}
                    disabled={disabled}
                />
            ))}
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
    scheduleIcon: {
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
    expandedTags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingLeft: 40,
        paddingRight: 8,
        paddingBottom: 5,
    },
    expandedTag: {
        marginBottom: 8,
    },
    tagSpacing: {
        marginLeft: 8,
    },
    disabledRow: {
        opacity: 0.5,
    },
})
