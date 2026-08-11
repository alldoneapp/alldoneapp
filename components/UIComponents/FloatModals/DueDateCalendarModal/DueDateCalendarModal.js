import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import moment from 'moment'
import { Calendar, LocaleConfig } from 'react-native-calendars'
import Day from './Day'
import Arrow from './Arrow'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { locales } from '../../../StatisticsView/StatisticsSection/CalendarLocales'
import { useSelector } from 'react-redux'

LocaleConfig.locales = locales

export default function DueDateCalendarModal({
    task,
    inParentGoal,
    isObservedTabActive,
    initialDate,
    externalStyle,
    projectId,
    saveDueDateBeforeSaveTask,
    tasks,
    multipleTasks,
    updateGoalMilestone,
    closePopover,
    updateParentGoalReminderDate,
}) {
    const language = useSelector(state => state.loggedUser.language)
    const mondayFirstInCalendar = useSelector(state => state.loggedUser.mondayFirstInCalendar)
    const [currentDueDate, setCurrentDueDate] = useState(
        initialDate === BACKLOG_DATE_NUMERIC ? Date.now() : initialDate
    )

    const dateString = moment(currentDueDate).format('YYYY-MM-DD')
    LocaleConfig.defaultLocale = language

    useEffect(() => {
        setCurrentDueDate(initialDate === BACKLOG_DATE_NUMERIC ? Date.now() : initialDate)
    }, [initialDate])

    return (
        <View style={[localStyles.calendarContainer, externalStyle]}>
            <Calendar
                current={dateString}
                firstDay={mondayFirstInCalendar}
                minDate={moment().format('YYYY-MM-DD')}
                markingType={'custom'}
                markedDates={{
                    [dateString]: {
                        customStyles: customStylesMarkedDatesCalendar,
                        marked: true,
                        selected: false,
                    },
                }}
                renderArrow={direction => <Arrow direction={direction} />}
                style={localStyles.calendar}
                theme={calendarTheme}
                dayComponent={({ date, state }) => {
                    return (
                        <Day
                            inParentGoal={inParentGoal}
                            date={date}
                            currentDueDate={currentDueDate}
                            disabled={state === 'disabled'}
                            updateDate={setCurrentDueDate}
                            task={task}
                            projectId={projectId}
                            saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                            tasks={tasks}
                            multipleTasks={multipleTasks}
                            updateGoalMilestone={updateGoalMilestone}
                            isObservedTabActive={isObservedTabActive}
                            closePopover={closePopover}
                            updateParentGoalReminderDate={updateParentGoalReminderDate}
                        />
                    )
                }}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    calendarContainer: {
        marginTop: -10,
    },
    calendar: {
        marginLeft: 16,
        marginRight: 16,
        paddingLeft: 0,
        paddingRight: 0,
    },
    today: {
        color: '#ffffff',
    },
})

const calendarTheme = {
    backgroundColor: colors.Secondary400,
    calendarBackground: colors.Secondary400,
    textSectionTitleColor: colors.Text03,
    selectedDayBackgroundColor: '#00adf5',
    selectedDayTextColor: '#ffffff',
    todayTextColor: 'white',
    dayTextColor: colors.Text03,
    textDisabledColor: colors.Text02,
    dotColor: '#00adf5',
    selectedDotColor: '#ffffff',
    arrowColor: 'orange',
    disabledArrowColor: '#d9e1e8',
    monthTextColor: 'white',
    indicatorColor: 'blue',
    textDayFontFamily: styles.overline.fontFamily,
    textDayFontSize: 16,
    textDayFontWeight: '300',
    textDayHeaderFontFamily: styles.overline.fontFamily,
    textDayHeaderFontWeight: 'normal',
    textDayHeaderFontSize: styles.overline.fontSize,
    textMonthFontFamily: styles.subtitle1.fontFamily,
    textMonthFontWeight: '500',
    textMonthFontSize: styles.subtitle1.fontSize,
    'stylesheet.calendar.header': {
        header: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingVertical: 0,
            marginTop: 0,
            alignItems: 'center',
            paddingHorizontal: 0,
        },
        week: {
            marginTop: 5,
            flexDirection: 'row',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            paddingHorizontal: 0,
            paddingTop: 12,
            paddingBottom: 4,
            marginHorizontal: 0,
            borderBottomColor: hexColorToRGBa('#ffffff', 0.2),
        },
    },
    'stylesheet.calendar.main': {
        week: {
            marginTop: 7,
            marginBottom: 7,
            marginHorizontal: -4,
            flexDirection: 'row',
            justifyContent: 'space-around',
        },
    },
}

const customStylesMarkedDatesCalendar = {
    container: {
        width: 32,
        height: 32,
        borderWidth: 2,
        borderRadius: 4,
        borderColor: colors.Primary200,
        backgroundColor: colors.Secondary400,
        padding: 4,
    },
    text: {
        marginTop: 0,
    },
}
