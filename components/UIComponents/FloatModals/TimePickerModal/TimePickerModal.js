import React from 'react'
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native'
import moment from 'moment'
import { colors } from '../../../styles/global'
import styles from '../../../styles/global'

export default function TimePickerModal({ initialTime, closePopover, updateTime, saveTimeBeforeSaveTask, timeFormat }) {
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
    const currentTime = moment(initialTime)
    const currentHour = currentTime.hour()

    return (
        <View style={localStyles.container}>
            <View style={localStyles.timeList}>
                {timeOptions.map((option, index) => (
                    <TouchableOpacity
                        key={index}
                        style={[
                            localStyles.timeOption,
                            currentHour === option.hour && localStyles.currentHourSection,
                            currentTime.format(timeFormat) === option.label && localStyles.selectedTime,
                        ]}
                        onPress={() => {
                            const selectedTime = moment().hour(option.hour).minute(option.minute)
                            updateTime(selectedTime)
                            saveTimeBeforeSaveTask(selectedTime)
                        }}
                    >
                        <Text
                            style={[
                                styles.subtitle2,
                                {
                                    color: currentTime.format(timeFormat) === option.label ? '#ffffff' : colors.Text02,
                                },
                            ]}
                        >
                            {option.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 8,
        width: 120,
    },
    timeList: {
        maxHeight: 300,
        overflow: 'auto',
    },
    timeOption: {
        padding: 8,
        borderRadius: 4,
    },
    currentHourSection: {
        backgroundColor: colors.Secondary300,
    },
    selectedTime: {
        backgroundColor: colors.Primary500,
    },
})
