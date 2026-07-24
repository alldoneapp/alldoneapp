import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import moment from 'moment'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'
import { getTimeFormat } from '../DateFormatPickerModal'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { setTaskAlert } from '../../../../utils/backends/Tasks/tasksFirestore'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'

export default function AlertTimeModal({ task, projectId, closePopover, delayClosePopover }) {
    const [width, height] = useWindowSize()
    const [alertEnabled, setAlertEnabledState] = useState(task?.alertEnabled || false)
    const [selectedTime, setSelectedTime] = useState(task?.dueDate ? moment(task.dueDate) : moment().hour(9).minute(0))

    // Update state when task prop changes (for when modal reopens with updated task)
    useEffect(() => {
        if (task) {
            setAlertEnabledState(task.alertEnabled || false)
            if (task.dueDate) {
                setSelectedTime(moment(task.dueDate))
            }
        }
    }, [task?.alertEnabled, task?.dueDate])

    const timeFormat = getTimeFormat()

    const generateTimeOptions = () => {
        const options = []
        for (let hour = 0; hour < 24; hour++) {
            for (let minute of [0, 15, 30, 45]) {
                const time = moment().hour(hour).minute(minute)
                options.push({
                    value: time.valueOf(),
                    label: time.format(timeFormat),
                    hour,
                    minute,
                })
            }
        }
        return options
    }

    const timeOptions = generateTimeOptions()

    const handleDisableAlert = async () => {
        if (task && task.id !== 'temp') {
            await setTaskAlert(projectId, task.id, false, selectedTime, task)
            delayClosePopover()
        }
    }

    const handleSelectTime = async option => {
        const newTime = moment(selectedTime).hour(option.hour).minute(option.minute)
        setSelectedTime(newTime)

        if (task && task.id !== 'temp') {
            // Save with alert enabled and the new time
            await setTaskAlert(projectId, task.id, true, newTime, task)
            delayClosePopover()
        }
    }

    const closePopup = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        closePopover()
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView showsVerticalScrollIndicator={false}>
                <View style={localStyles.title}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Alert time')}</Text>
                    <Text style={[styles.body2, { color: colors.Text03 }]}>{translate('Select alert time')}</Text>
                </View>

                <View style={localStyles.alertSection}>
                    <TouchableOpacity style={localStyles.alertOption} onPress={handleDisableAlert}>
                        <View style={localStyles.alertOptionInner}>
                            <View style={localStyles.alertText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                    {translate('Disable alert')}
                                </Text>
                            </View>
                            <View style={localStyles.alertCheck}>
                                {!alertEnabled && <Icon name={'check'} size={24} color={'#ffffff'} />}
                            </View>
                        </View>
                    </TouchableOpacity>
                </View>

                <View style={localStyles.sectionSeparator} />

                <View style={localStyles.timeSection}>
                    {timeOptions.map((option, index) => {
                        const isSelected = alertEnabled && selectedTime.format(timeFormat) === option.label
                        return (
                            <TouchableOpacity
                                key={index}
                                style={localStyles.timeOption}
                                onPress={() => handleSelectTime(option)}
                            >
                                <View style={localStyles.timeOptionInner}>
                                    <View style={localStyles.timeText}>
                                        <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{option.label}</Text>
                                    </View>
                                    <View style={localStyles.timeCheck}>
                                        {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                                    </View>
                                </View>
                            </TouchableOpacity>
                        )
                    })}
                </View>

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closePopup}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 8,
        borderRadius: 4,
        width: 305,
        overflow: 'visible',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    title: {
        marginBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
    },
    alertSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
    },
    alertOption: {
        paddingLeft: 16,
        paddingRight: 16,
        minHeight: 48,
        justifyContent: 'center',
    },
    alertOptionInner: {
        minHeight: 48,
        alignItems: 'center',
        flexDirection: 'row',
    },
    alertText: {
        flex: 1,
        justifyContent: 'center',
    },
    alertCheck: {
        width: 30,
        alignItems: 'flex-end',
    },
    sectionSeparator: {
        height: 1,
        backgroundColor: colors.Secondary300,
        marginVertical: 8,
        marginHorizontal: 16,
    },
    timeSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
    },
    timeOption: {
        paddingLeft: 16,
        paddingRight: 16,
        minHeight: 48,
        justifyContent: 'center',
    },
    timeOptionInner: {
        minHeight: 48,
        alignItems: 'center',
        flexDirection: 'row',
    },
    timeText: {
        flex: 1,
        justifyContent: 'center',
    },
    timeCheck: {
        width: 30,
        alignItems: 'flex-end',
    },
    closeContainer: {
        position: 'absolute',
        top: 16,
        right: 16,
    },
    closeButton: {
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
})
