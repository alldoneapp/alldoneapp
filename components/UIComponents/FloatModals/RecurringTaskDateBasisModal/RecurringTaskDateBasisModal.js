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
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { withWindowSizeHook } from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import { RECURRENCE_DATE_BASIS_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { RECURRENCE_NEVER, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../TaskListView/Utils/TasksHelper'

export const getTaskRecurrenceValue = task => {
    const recurrence = task?.recurrence
    return recurrence && typeof recurrence === 'object' ? recurrence.type : recurrence
}

export const shouldShowRecurringTaskDateBasisModal = task => {
    const recurrence = getTaskRecurrenceValue(task)
    return (
        !!task &&
        !task.done &&
        !task.parentId &&
        task.assigneeType !== TASK_ASSIGNEE_ASSISTANT_TYPE &&
        recurrence &&
        recurrence !== RECURRENCE_NEVER &&
        typeof task.recurrenceOriginalDueDate === 'number' &&
        Array.isArray(task.userIds) &&
        task.userIds.length === 1
    )
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
                                {moment(date).format('D MMM')}
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

    useEffect(() => {
        storeModal(RECURRENCE_DATE_BASIS_MODAL_ID)
        return () => {
            removeModal(RECURRENCE_DATE_BASIS_MODAL_ID)
        }
    }, [])

    const selectOriginalDate = () => {
        selectDateBasis(task.recurrenceOriginalDueDate)
    }

    const selectCurrentDate = () => {
        selectDateBasis(Date.now())
    }

    const selectCustomDate = date => {
        selectDateBasis(date)
    }

    const close = event => {
        event.preventDefault()
        event.stopPropagation()
        closePopover()
    }

    const title = visibleCalendar ? translate('Pick date') : translate('Select recurring task date')
    const description = visibleCalendar
        ? translate('Select the custom base date for the next recurring task')
        : translate('Choose how Alldone should schedule the next recurring task')
    const maxHeight = (windowSize?.[1] || 600) - MODAL_MAX_HEIGHT_GAP

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight }]}>
            <Hotkeys
                keyName={'esc,enter'}
                onKeyDown={(sht, event) => (sht === 'enter' ? selectCurrentDate() : close(event))}
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
                                saveDueDateBeforeSaveTask={selectCustomDate}
                                initialDate={Date.now()}
                                isObservedTabActive={false}
                            />
                            <View style={localStyles.sectionSeparator} />
                            <DueDateCalendarModalFooter setVisibleCalendar={setVisibleCalendar} />
                        </View>
                    ) : (
                        <View style={localStyles.options}>
                            <RecurrenceDateBasisOption
                                icon={'rotate-cw'}
                                text={'Original date'}
                                date={task.recurrenceOriginalDueDate}
                                shortcut={'1'}
                                onPress={selectOriginalDate}
                            />
                            <RecurrenceDateBasisOption
                                icon={'clock'}
                                text={'Current date'}
                                date={Date.now()}
                                shortcut={'2'}
                                onPress={selectCurrentDate}
                            />
                            <RecurrenceDateBasisOption
                                icon={'calendar'}
                                text={'Custom date'}
                                shortcut={'3'}
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
