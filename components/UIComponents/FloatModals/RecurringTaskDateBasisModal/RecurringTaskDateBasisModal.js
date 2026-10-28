import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import moment from 'moment'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import DueDateCalendarModal from '../DueDateCalendarModal/DueDateCalendarModal'
import DueDateCalendarModalFooter from '../DueDateModal/DueDateCalendarModalFooter'
import Header from '../DueDateModal/Header'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import { RECURRENCE_DATE_BASIS_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'
import {
    getRecurrenceDateBasisOptions,
    RECURRENCE_BASIS_ORIGINAL,
    RECURRENCE_BASIS_SCHEDULED,
    RECURRENCE_BASIS_TODAY,
    toRecurrenceBaseDate,
} from './recurringTaskDateBasis'

// Kept here so the completion paths (and the suites that mock this module) keep their import.
export { getTaskRecurrenceValue, shouldShowRecurringTaskDateBasisModal } from './recurringTaskDateBasis'

const OPTION_PRESENTATION = {
    [RECURRENCE_BASIS_ORIGINAL]: { icon: 'rotate-cw', text: 'Original date' },
    [RECURRENCE_BASIS_SCHEDULED]: { icon: 'calendar-up', text: 'Current due date' },
    [RECURRENCE_BASIS_TODAY]: { icon: 'clock', text: 'Today' },
}

function RecurrenceDateBasisOption({ icon, text, date, shortcut, onPress }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const selectOption = event => {
        event.preventDefault()
        event.stopPropagation()
        onPress()
    }

    return (
        <Hotkeys keyName={shortcut} onKeyDown={(sht, event) => selectOption(event)} filter={e => true}>
            <TouchableOpacity style={localStyles.option} onPress={selectOption} accessible={false}>
                <View style={localStyles.option}>
                    <View style={localStyles.optionText}>
                        <Icon name={icon} size={24} color={'#ffffff'} style={localStyles.icon} />
                        <Text style={[styles.subtitle1, localStyles.label]}>{translate(text)}</Text>
                        {date && (
                            <Text style={[styles.body1, localStyles.date]}>
                                {' • '}
                                {moment(date).format(
                                    moment(date).isSame(moment(), 'year') ? 'ddd, D MMM' : 'ddd, D MMM YYYY'
                                )}
                            </Text>
                        )}
                    </View>
                    <View style={localStyles.shortcut}>
                        {!smallScreenNavigation && <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} />}
                    </View>
                </View>
            </TouchableOpacity>
        </Hotkeys>
    )
}

function RecurringTaskDateBasisModal({ task, projectId, closePopover, selectDateBasis, windowSize }) {
    const [visibleCalendar, setVisibleCalendar] = useState(false)
    // One "now" for the whole popup, so the rows cannot change under the user around midnight.
    const [now] = useState(() => Date.now())
    const options = getRecurrenceDateBasisOptions(task, now)
    const customShortcut = String(options.length + 1)

    useEffect(() => {
        storeModal(RECURRENCE_DATE_BASIS_MODAL_ID)
        return () => {
            removeModal(RECURRENCE_DATE_BASIS_MODAL_ID)
        }
    }, [])

    const selectDate = date => {
        selectDateBasis(toRecurrenceBaseDate(date))
    }

    const close = event => {
        event.preventDefault()
        event.stopPropagation()
        closePopover()
    }

    const title = visibleCalendar ? translate('Pick date') : translate('Select recurring task date')
    const description = visibleCalendar
        ? translate('Select the custom base date for the next recurring task')
        : translate('Choose the date the interval of the next recurring task is counted from')
    const maxHeight = getSafeAreaModalMaxHeight(windowSize?.[1] || 600)

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight }]}>
            <Hotkeys
                keyName={'esc,enter'}
                // Enter keeps what a completion without this popup does: count from today.
                onKeyDown={(sht, event) => (sht === 'enter' ? selectDate(now) : close(event))}
                filter={e => true}
            >
                <CustomScrollView showsVerticalScrollIndicator={false}>
                    <Header delayClosePopover={closePopover} title={title} description={description} showTabs={false} />
                    {visibleCalendar ? (
                        <View>
                            <DueDateCalendarModal
                                task={task}
                                projectId={projectId}
                                closePopover={() => {}}
                                saveDueDateBeforeSaveTask={selectDate}
                                initialDate={now}
                                isObservedTabActive={false}
                            />
                            <View style={localStyles.sectionSeparator} />
                            <DueDateCalendarModalFooter setVisibleCalendar={setVisibleCalendar} />
                        </View>
                    ) : (
                        <View style={localStyles.options}>
                            {options.map((option, index) => (
                                <RecurrenceDateBasisOption
                                    key={option.key}
                                    icon={OPTION_PRESENTATION[option.key].icon}
                                    text={OPTION_PRESENTATION[option.key].text}
                                    date={option.date}
                                    shortcut={String(index + 1)}
                                    onPress={() => selectDate(option.date)}
                                />
                            ))}
                            <RecurrenceDateBasisOption
                                icon={'calendar'}
                                text={'Custom date'}
                                shortcut={customShortcut}
                                onPress={() => setVisibleCalendar(true)}
                            />
                        </View>
                    )}
                </CustomScrollView>
            </Hotkeys>
        </View>
    )
}

export default withWindowSizeHook(RecurringTaskDateBasisModal)

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 8,
        borderRadius: 4,
    },
    options: {
        paddingLeft: 16,
        paddingRight: 16,
    },
    option: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    optionText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    icon: {
        marginRight: 8,
    },
    label: {
        color: '#ffffff',
    },
    date: {
        color: colors.Text03,
    },
    shortcut: {
        justifyContent: 'flex-end',
    },
    sectionSeparator: {
        height: 1,
        backgroundColor: colors.Text03,
        opacity: 0.16,
        marginVertical: 8,
    },
})
