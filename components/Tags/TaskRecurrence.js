import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import Popover from 'react-tiny-popover'
import RecurrenceModal from '../UIComponents/FloatModals/RecurrenceModal'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'
import { RECURRENCE_MAP } from '../TaskListView/Utils/TasksHelper'

const TaskRecurrence = ({
    task,
    projectId,
    isMobile,
    disabled,
    outline,
    style,
    subscribeClickObserver,
    unsubscribeClickObserver,
}) => {
    const [visiblePopover, setVisiblePopover] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    useEffect(() => {
        unsubscribeClickObserver?.()
        return () => subscribeClickObserver?.()
    }, [])

    const { recurrence } = task

    // Robust handling of recurrence format variations
    const getRecurrenceValue = recurrenceData => {
        // Handle null/undefined
        if (!recurrenceData) {
            return 'never'
        }

        // Handle string format (e.g., 'never', 'daily')
        if (typeof recurrenceData === 'string') {
            return recurrenceData
        }

        // Handle object format (e.g., { type: 'never' })
        if (typeof recurrenceData === 'object' && recurrenceData.type) {
            return recurrenceData.type
        }

        // Fallback for any unexpected format
        return 'never'
    }

    const recurrenceValue = getRecurrenceValue(recurrence)

    // Ensure the recurrence value exists in RECURRENCE_MAP
    const recurrenceData = RECURRENCE_MAP[recurrenceValue] || RECURRENCE_MAP['never']

    return (
        <Popover
            content={
                <RecurrenceModal task={task} projectId={projectId} closePopover={() => setVisiblePopover(false)} />
            }
            onClickOutside={() => setVisiblePopover(false)}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <TouchableOpacity
                onPress={() => setVisiblePopover(true)}
                disabled={!task.name || disabled}
                accessible={false}
            >
                <View style={[(outline ? otl : localStyles).container, style]}>
                    <Icon
                        name={'rotate-cw'}
                        size={outline ? 14 : 16}
                        color={outline ? colors.UtilityBlue200 : colors.Text03}
                        style={(outline ? otl : localStyles).icon}
                    />
                    <Text style={[(outline ? otl : localStyles).text, windowTagStyle()]}>
                        {translate(
                            outline || smallScreenNavigation || isMobile ? recurrenceData.short : recurrenceData.large
                        )}
                    </Text>
                </View>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})

const otl = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: colors.UtilityBlue200,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
    },
    icon: {
        marginHorizontal: 3,
    },
    text: {
        ...styles.caption1,
        color: colors.UtilityBlue200,
        marginVertical: 1,
        marginRight: 6,
        marginLeft: 2,
    },
})

export default TaskRecurrence
