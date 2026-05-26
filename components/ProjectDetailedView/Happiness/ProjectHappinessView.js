import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { Calendar, LocaleConfig } from 'react-native-calendars'
import v4 from 'uuid/v4'
import moment from 'moment'
import { useSelector } from 'react-redux'

import Backend from '../../../utils/BackendBridge'
import URLsProjects, { URL_PROJECT_DETAILS_HAPPINESS } from '../../../URLSystem/Projects/URLsProjects'
import Button from '../../UIControls/Button'
import HappinessRatingPicker from '../../ProjectHappiness/HappinessRatingPicker'
import HappinessStatsPanel from '../../ProjectHappiness/HappinessStatsPanel'
import styles, { colors, hexColorToRGBa } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import {
    getHappinessDateText,
    getHappinessRatingText,
    HAPPINESS_PRIVACY_TEXT,
} from '../../../utils/ProjectHappinessHelper'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { locales } from '../../StatisticsView/StatisticsSection/CalendarLocales'
import Icon from '../../Icon'

LocaleConfig.locales = locales

function HappinessRow({ entry, project, userId }) {
    const [comment, setComment] = useState(entry.comment || '')

    useEffect(() => {
        setComment(entry.comment || '')
    }, [entry.comment])

    const saveRating = rating => {
        Backend.setProjectHappiness(project.id, userId, entry.timestamp, rating, comment, project)
    }

    const saveComment = () => {
        Backend.setProjectHappiness(project.id, userId, entry.timestamp, entry.rating, comment, project)
    }

    const clear = () => {
        Backend.setProjectHappiness(project.id, userId, entry.timestamp, null, '', project)
    }

    return (
        <View style={localStyles.row}>
            <View style={localStyles.rowHeader}>
                <View>
                    <Text style={localStyles.date}>{getHappinessDateText(entry.timestamp)}</Text>
                    <Text style={localStyles.ratingText}>{getHappinessRatingText(entry.rating)}</Text>
                </View>
                <HappinessRatingPicker value={entry.rating} onChange={saveRating} compact />
            </View>
            <TextInput
                style={localStyles.commentInput}
                multiline
                value={comment}
                placeholder={translate('Add comment')}
                placeholderTextColor={colors.Text03}
                onChangeText={setComment}
            />
            <View style={localStyles.rowActions}>
                <Button title={translate('Save comment')} type="ghost" icon="save" onPress={saveComment} />
                <TouchableOpacity style={localStyles.clearButton} onPress={clear}>
                    <Text style={localStyles.clearText}>{translate('Clear')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

export default function ProjectHappinessView({ project, userId }) {
    const language = useSelector(state => state.loggedUser.language)
    const mondayFirstInCalendar = useSelector(state => state.loggedUser.mondayFirstInCalendar)
    const smallScreen = useSelector(state => state.smallScreen)
    const [entries, setEntries] = useState([])
    const [selectedDate, setSelectedDate] = useState(moment().subtract(1, 'day').startOf('day').valueOf())
    const [showDatePicker, setShowDatePicker] = useState(false)
    const [showAddForm, setShowAddForm] = useState(false)
    const [rating, setRating] = useState(null)
    const [comment, setComment] = useState('')
    const watcherKeyRef = useRef(`project_happiness_${v4()}`)
    LocaleConfig.defaultLocale = language

    useEffect(() => {
        URLsProjects.push(URL_PROJECT_DETAILS_HAPPINESS, { projectId: project.id, userId }, project.id)
        Backend.watchProjectHappiness(project.id, userId, watcherKeyRef.current, (projectId, entries) => {
            setEntries(entries)
        })
        return () => Backend.unwatch(watcherKeyRef.current)
    }, [project.id, userId])

    const date = moment(selectedDate)
    const selectedDateString = date.format('YYYY-MM-DD')
    const canAdd = date.isValid() && rating

    const addDate = () => {
        if (!canAdd) return
        Backend.setProjectHappiness(project.id, userId, date.valueOf(), rating, comment, project)
        setRating(null)
        setComment('')
        setShowAddForm(false)
    }

    const selectDate = day => {
        setSelectedDate(moment(day.dateString, 'YYYY-MM-DD').startOf('day').valueOf())
        setShowDatePicker(false)
    }

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Happiness')}</Text>
            <Text style={localStyles.privacy}>{translate(HAPPINESS_PRIVACY_TEXT)}</Text>

            <HappinessStatsPanel entries={entries} showRecentComments={false} />

            {showAddForm && (
                <View style={localStyles.addBox}>
                    <Text style={localStyles.sectionTitle}>{translate('Add past date')}</Text>
                    <View style={localStyles.addHeader}>
                        <Popover
                            isOpen={showDatePicker}
                            onClickOutside={() => setShowDatePicker(false)}
                            position={['bottom', 'top', 'right', 'left']}
                            padding={4}
                            align="start"
                            contentLocation={smallScreen ? null : undefined}
                            content={
                                <View style={localStyles.calendarContainer}>
                                    <Calendar
                                        current={selectedDateString}
                                        maxDate={moment().format('YYYY-MM-DD')}
                                        firstDay={mondayFirstInCalendar}
                                        onDayPress={selectDate}
                                        markingType="custom"
                                        markedDates={{
                                            [selectedDateString]: {
                                                customStyles: customStylesMarkedDatesCalendar,
                                                marked: true,
                                                selected: false,
                                            },
                                        }}
                                        renderArrow={direction => (
                                            <Icon
                                                name={direction === 'left' ? 'chevron-left' : 'chevron-right'}
                                                size={24}
                                                color={colors.Text03}
                                            />
                                        )}
                                        theme={calendarTheme}
                                    />
                                </View>
                            }
                        >
                            <View>
                                <Button
                                    title={date.format(getDateFormat())}
                                    type="ghost"
                                    icon="calendar"
                                    onPress={() => setShowDatePicker(true)}
                                    buttonStyle={localStyles.dateButton}
                                />
                            </View>
                        </Popover>
                        <HappinessRatingPicker value={rating} onChange={setRating} compact />
                    </View>
                    <TextInput
                        style={localStyles.commentInput}
                        multiline
                        value={comment}
                        placeholder={translate('Add comment')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={setComment}
                    />
                    <Button
                        title={translate('Save')}
                        type="primary"
                        icon="save"
                        onPress={addDate}
                        disabled={!canAdd}
                        buttonStyle={localStyles.addButton}
                    />
                </View>
            )}

            <View style={localStyles.historyHeader}>
                <Text style={localStyles.sectionTitle}>{translate('History')}</Text>
                {!showAddForm && (
                    <Button
                        title={translate('Add happiness')}
                        type="primary"
                        icon="plus"
                        onPress={() => setShowAddForm(true)}
                        buttonStyle={localStyles.historyAddButton}
                    />
                )}
            </View>
            {entries.length > 0 ? (
                [...entries]
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .map(entry => <HappinessRow key={entry.id} entry={entry} project={project} userId={userId} />)
            ) : (
                <Text style={localStyles.emptyText}>{translate('No happiness data yet')}</Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 24,
    },
    title: {
        ...styles.title4,
        color: colors.Text01,
    },
    privacy: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    addBox: {
        borderWidth: 1,
        borderColor: colors.Grey200,
        borderRadius: 4,
        padding: 12,
        marginBottom: 24,
    },
    sectionTitle: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 8,
    },
    historyHeader: {
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    historyAddButton: {
        marginBottom: 8,
    },
    addHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    dateButton: {
        marginRight: 8,
    },
    calendarContainer: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 12,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    commentInput: {
        ...styles.body2,
        color: colors.Text01,
        minHeight: 72,
        borderWidth: 1,
        borderColor: colors.Grey200,
        borderRadius: 4,
        padding: 8,
        textAlignVertical: 'top',
        marginTop: 8,
    },
    addButton: {
        alignSelf: 'flex-start',
        marginTop: 8,
    },
    row: {
        borderBottomWidth: 1,
        borderColor: colors.Grey200,
        paddingVertical: 12,
    },
    rowHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    date: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    ratingText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 2,
    },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    clearButton: {
        height: 40,
        justifyContent: 'center',
        paddingHorizontal: 12,
        marginLeft: 8,
    },
    clearText: {
        ...styles.subtitle2,
        color: colors.UtilityRed200,
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text03,
    },
})

const calendarTheme = {
    backgroundColor: colors.Secondary400,
    calendarBackground: colors.Secondary400,
    textSectionTitleColor: colors.Text03,
    selectedDayBackgroundColor: colors.Primary300,
    selectedDayTextColor: '#ffffff',
    todayTextColor: '#ffffff',
    dayTextColor: colors.Text03,
    textDisabledColor: colors.Text02,
    dotColor: colors.Primary300,
    selectedDotColor: '#ffffff',
    monthTextColor: '#ffffff',
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
        color: '#ffffff',
    },
}
