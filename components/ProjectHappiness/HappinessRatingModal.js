import React, { useState } from 'react'
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import AppCalendar from '../UIComponents/Calendar/AppCalendar'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import Icon from '../Icon'
import ProjectDayActivity from './ProjectDayActivity'
import ProjectHappinessRatingList, { isProjectRatedForDay } from './ProjectHappinessRatingList'
import styles, { colors, em2px, hexColorToRGBa } from '../styles/global'
import useEscapeKey from '../../hooks/useEscapeKey'
import useHappinessRatedDays from './useHappinessRatedDays'
import useProjectDayStatistics from './useProjectDayStatistics'
import useProjectHappinessEditor from './useProjectHappinessEditor'
import useSafeAreaOverlayPadding from '../../hooks/useSafeAreaOverlayPadding'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { getHappinessProjects } from './happinessProjects'
import { translate } from '../../i18n/TranslationService'

const CALENDAR_DATE_FORMAT = 'YYYY-MM-DD'

export const getTodayHappinessDate = () => moment().startOf('day').valueOf()

/**
 * Is `date` a day the user can still rate? (AT-2392)
 *
 * Only today and the past: a happiness rating is a report on a day that
 * happened, and the stats/trend panels read the stored days as history. The
 * calendar already refuses to hand out a future day through `maxDate`; this is
 * the second half of that guard, so a locale/format edge case cannot slip one
 * through.
 */
export const isRatableHappinessDate = (date, now = Date.now()) => {
    const day = moment(date)
    return day.isValid() && !day.startOf('day').isAfter(moment(now).startOf('day'), 'day')
}

/**
 * "N of M projects rated on this day" / "No ratings for this day yet".
 *
 * Counted from the editor's STORED entries, so a rating tapped a moment ago
 * is included as soon as its write lands in the local cache — and a day that
 * was rated last week reads as rated before anything is touched.
 */
export const getRatedProjectsSummary = (editor, projects) => {
    const rated = projects.filter(project => isProjectRatedForDay(editor, project.id)).length
    if (rated === 0) return translate('No ratings for this day yet')
    return translate('happiness rated projects summary', { rated, total: projects.length })
}

/**
 * "Rate happiness" — the on-demand version of the new-day popup (AT-2392).
 *
 * Same card, same rows, same write path (`useProjectHappinessEditor` +
 * `ProjectHappinessRatingList`); the one thing it adds is a date picker, so a
 * day that was missed — the popup only ever rates the day that just ended —
 * can still be rated afterwards.
 *
 * Ratings are stored the moment they are tapped, exactly as in the new-day
 * popup, so "Done" only flushes an unsaved comment and closes. That is also
 * why closing by Escape or the × can never lose a rating.
 *
 * Three things tell the user where they stand before they rate: every row
 * shows that day's "Tasks done" in the project (the same line the new-day
 * popup shows, read from the same statistics documents), every row says
 * whether the day is already rated in that project, and the date picker
 * marks already-rated days with a dot.
 */
export default function HappinessRatingModal({ onClose }) {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreen = useSelector(state => state.smallScreen)

    const [selectedDate, setSelectedDate] = useState(getTodayHappinessDate)
    const [showDatePicker, setShowDatePicker] = useState(false)
    // The month the calendar is showing — what the rated-day dots are read for.
    const [visibleMonth, setVisibleMonth] = useState(selectedDate)

    const compactModalLayout = smallScreenNavigation || isMiddleScreen
    const happinessProjects = getHappinessProjects(loggedUserProjects, loggedUser)
    const canReadData = !loggedUser.isAnonymous

    const happinessEditor = useProjectHappinessEditor({
        projects: happinessProjects,
        userId: loggedUser.uid,
        date: selectedDate,
        watchEnabled: canReadData,
        watcherKeyPrefix: `settings_happiness_rating_${loggedUser.uid}`,
    })

    const { doneTasksByProject, maxDoneTasks } = useProjectDayStatistics({
        projects: happinessProjects,
        userId: loggedUser.uid,
        date: selectedDate,
        enabled: canReadData,
    })

    const ratedProjectsByDay = useHappinessRatedDays({
        projects: happinessProjects,
        userId: loggedUser.uid,
        month: visibleMonth,
        enabled: canReadData && showDatePicker,
        watcherKeyPrefix: `settings_happiness_rated_days_${loggedUser.uid}`,
    })

    const close = () => {
        // A comment that was typed but never blurred is still a rating the
        // user made. Nothing is awaited: the write is durable locally and
        // waiting on the server ack would hang the close offline (AT-2340).
        happinessEditor.saveDirtyEntries()
        onClose()
    }

    // LIFO (AT-2257): with the calendar open, Escape closes the calendar and
    // leaves this popup up.
    useEscapeKey(() => {
        if (showDatePicker) setShowDatePicker(false)
        else close()
    })

    const selectedMoment = moment(selectedDate)
    const selectedDateString = selectedMoment.format(CALENDAR_DATE_FORMAT)

    const selectDate = day => {
        const date = moment(day.dateString, CALENDAR_DATE_FORMAT).startOf('day').valueOf()
        setShowDatePicker(false)
        if (!isRatableHappinessDate(date)) return
        // Switching the day flushes and clears the previous day's drafts —
        // see `useProjectHappinessEditor`.
        setSelectedDate(date)
        setVisibleMonth(date)
    }

    const openDatePicker = () => {
        setVisibleMonth(selectedDate)
        setShowDatePicker(true)
    }

    // Every already-rated day of the visible month gets a dot; the selected
    // day keeps its outline on top of that.
    const markedDates = Object.keys(ratedProjectsByDay).reduce((marked, day) => {
        marked[day] = { marked: true, dotColor: colors.Primary200 }
        return marked
    }, {})
    markedDates[selectedDateString] = {
        ...markedDates[selectedDateString],
        customStyles: customStylesMarkedDatesCalendar,
        marked: true,
        selected: false,
    }

    const renderProjectDayActivity = project => (
        <ProjectDayActivity
            doneTasks={doneTasksByProject[project.id]}
            maxDoneTasks={maxDoneTasks}
            testID={`happinessDayActivity_${project.id}`}
        />
    )

    return (
        <View style={[localStyles.parent, safeAreaOverlayPadding]}>
            <View
                style={[localStyles.container, compactModalLayout && localStyles.mobileContainer, applyPopoverWidth()]}
            >
                <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={localStyles.header}>
                        <View style={localStyles.headerText}>
                            <Text style={localStyles.title}>{translate('Rate happiness')}</Text>
                            <Text style={localStyles.description}>{translate('Pick the day you want to rate')}</Text>
                        </View>
                        <TouchableOpacity style={localStyles.closeButton} testID="closeHappinessRating" onPress={close}>
                            <Icon name="x" size={24} color="#ffffff" />
                        </TouchableOpacity>
                    </View>

                    <AppPopover
                        isOpen={showDatePicker}
                        onClickOutside={() => setShowDatePicker(false)}
                        position={['bottom', 'top', 'right', 'left']}
                        padding={4}
                        align="start"
                        contentLocation={smallScreen ? null : undefined}
                        content={
                            <View style={localStyles.calendarContainer}>
                                <AppCalendar
                                    current={selectedDateString}
                                    maxDate={moment().format(CALENDAR_DATE_FORMAT)}
                                    onDayPress={selectDate}
                                    onMonthChange={month =>
                                        setVisibleMonth(moment(month.dateString, CALENDAR_DATE_FORMAT).valueOf())
                                    }
                                    markingType="custom"
                                    markedDates={markedDates}
                                />
                                <Text style={localStyles.calendarHint}>
                                    {translate('Days with a dot are already rated')}
                                </Text>
                            </View>
                        }
                    >
                        <TouchableOpacity
                            style={localStyles.dateButton}
                            testID="happinessRatingDateButton"
                            onPress={openDatePicker}
                        >
                            <Icon name="calendar" size={20} color="#ffffff" />
                            <Text style={localStyles.dateButtonText}>{selectedMoment.format(getDateFormat())}</Text>
                        </TouchableOpacity>
                    </AppPopover>

                    {happinessProjects.length > 0 && (
                        <View style={localStyles.summaryRow}>
                            <Icon name="smile" size={16} color={colors.Text04} />
                            <Text style={localStyles.summaryText} testID="happinessRatedSummary">
                                {getRatedProjectsSummary(happinessEditor, happinessProjects)}
                            </Text>
                        </View>
                    )}

                    {happinessProjects.length > 0 ? (
                        <ProjectHappinessRatingList
                            projects={happinessProjects}
                            editor={happinessEditor}
                            compact={compactModalLayout}
                            renderProjectMeta={renderProjectDayActivity}
                        />
                    ) : (
                        <Text style={localStyles.emptyText}>{translate('No projects to rate')}</Text>
                    )}

                    <View style={localStyles.line} />
                    <TouchableOpacity
                        style={[localStyles.doneButton, compactModalLayout && localStyles.mobileDoneButton]}
                        testID="doneHappinessRating"
                        onPress={close}
                    >
                        <Text style={localStyles.doneButtonText}>{translate('Done')}</Text>
                    </TouchableOpacity>
                </ScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
        ...Platform.select({ web: { position: 'fixed' } }),
    },
    container: {
        backgroundColor: colors.Secondary400,
        padding: 24,
        borderRadius: 8,
        // Content taller than the cap scrolls inside the card, exactly like
        // the new-day popup this is the on-demand version of.
        maxHeight: '90%',
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    mobileContainer: {
        padding: 20,
        maxHeight: '94%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        ...styles.title7,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    dateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        height: 40,
        paddingHorizontal: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    dateButtonText: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginLeft: 8,
    },
    calendarContainer: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 12,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    calendarHint: {
        ...styles.caption2,
        color: colors.Text04,
        marginTop: 8,
        textAlign: 'center',
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    summaryText: {
        ...styles.body2,
        color: colors.Text04,
        marginLeft: 6,
        flexShrink: 1,
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text04,
        marginTop: 16,
    },
    line: {
        height: 1,
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 20,
    },
    doneButton: {
        borderRadius: 4,
        backgroundColor: colors.Primary300,
        paddingHorizontal: 16,
        paddingVertical: 16,
        alignSelf: 'center',
    },
    mobileDoneButton: {
        alignSelf: 'stretch',
        alignItems: 'center',
        marginHorizontal: 4,
    },
    doneButtonText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: '500',
        color: '#FFFFFF',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
    },
})

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
        color: '#ffffff',
    },
}
