import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import TimePickerModal from '../../../UIComponents/FloatModals/TimePickerModal/TimePickerModal'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

const msToMoment = ms => {
    const hours = Math.floor(ms / 3600000)
    const minutes = Math.floor((ms % 3600000) / 60000)
    return moment().hour(hours).minute(minutes)
}

const momentToMs = m => {
    return (m.hours() * 60 + m.minutes()) * 60 * 1000
}

const formatTime = ms => {
    return msToMoment(ms).format('h:mm A')
}

export default function HeartbeatAwakeTimeProperty({ disabled, projectId, assistant }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const [editingField, setEditingField] = useState(null)

    const awakeStart = assistant.heartbeatAwakeStart ?? 28800000
    const awakeEnd = assistant.heartbeatAwakeEnd ?? 79200000

    const saveStartTime = time => {
        const ms = momentToMs(time)
        updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatAwakeStart: ms })
        setIsOpen(false)
        setEditingField(null)
    }

    const saveEndTime = time => {
        const ms = momentToMs(time)
        updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatAwakeEnd: ms })
        setIsOpen(false)
        setEditingField(null)
    }

    const openStartPicker = () => {
        setEditingField('start')
        setIsOpen(true)
    }

    const openEndPicker = () => {
        setEditingField('end')
        setIsOpen(true)
    }

    const closePicker = () => {
        setIsOpen(false)
        setEditingField(null)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'clock'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Awake time')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                    {`${formatTime(awakeStart)} - ${formatTime(awakeEnd)}`}
                </Text>
                <Popover
                    content={
                        <View style={localStyles.pickerContainer}>
                            <View style={localStyles.pickerColumn}>
                                <Text
                                    style={[
                                        styles.subtitle2,
                                        { color: colors.Text03, marginBottom: 4, paddingHorizontal: 8 },
                                    ]}
                                >
                                    {translate('Start')}
                                </Text>
                                <TimePickerModal
                                    initialTime={msToMoment(awakeStart).valueOf()}
                                    closePopover={closePicker}
                                    updateTime={saveStartTime}
                                    saveTimeBeforeSaveTask={saveStartTime}
                                    timeFormat={'h:mm A'}
                                />
                            </View>
                            <View style={localStyles.pickerColumn}>
                                <Text
                                    style={[
                                        styles.subtitle2,
                                        { color: colors.Text03, marginBottom: 4, paddingHorizontal: 8 },
                                    ]}
                                >
                                    {translate('End')}
                                </Text>
                                <TimePickerModal
                                    initialTime={msToMoment(awakeEnd).valueOf()}
                                    closePopover={closePicker}
                                    updateTime={saveEndTime}
                                    saveTimeBeforeSaveTask={saveEndTime}
                                    timeFormat={'h:mm A'}
                                />
                            </View>
                        </View>
                    }
                    onClickOutside={closePicker}
                    isOpen={isOpen}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button icon={'edit-2'} type={'ghost'} onPress={openStartPicker} disabled={disabled} />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
    pickerContainer: {
        flexDirection: 'row',
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 8,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    pickerColumn: {
        marginHorizontal: 4,
    },
})
