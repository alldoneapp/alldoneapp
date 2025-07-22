import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { toggleMyDayShowAllTasks } from '../../../../redux/actions'

export default function MoreTasksLine({ containerStyle }) {
    const dispatch = useDispatch()
    const myDayOtherTasksAmount = useSelector(state => state.myDayOtherTasks.length)
    const myDayShowAllTasks = useSelector(state => state.myDayShowAllTasks)
    const activeDragTaskModeInMyDay = useSelector(state => state.activeDragTaskModeInMyDay)
    const myDaySortingOtherTasksAmount = useSelector(state => state.myDaySortingOtherTasks.length)

    const tasksAmount = activeDragTaskModeInMyDay ? myDaySortingOtherTasksAmount : myDayOtherTasksAmount

    const onPress = () => {
        dispatch(toggleMyDayShowAllTasks())
    }

    const text = myDayShowAllTasks
        ? translate('hide later tasks')
        : translate('more tasks have a reminder date of today', { tasksAmount: tasksAmount })

    return (
        <TouchableOpacity onPress={onPress} style={[localStyles.container, containerStyle]}>
            <Text style={localStyles.text}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.UtilityOrange400,
        borderRadius: 4,
        height: 24,
        alignItems: 'center',
        justifyContent: 'flex-start',
        marginTop: 16,
    },
    text: {
        ...styles.subtitle2,
        color: '#000000',
        zIndex: 1,
        paddingLeft: 12,
    },
})
