import React, { useEffect, useState } from 'react'
import moment from 'moment'
import v4 from 'uuid/v4'

import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import Backend from '../../utils/BackendBridge'
import { translate } from '../../i18n/TranslationService'

export default function MilestoneStatistics({
    projectId,
    previousMilestoneTimestamp,
    milestoneTimestamp,
    inDone,
    inBacklog,
}) {
    const [tasksAmount, setTasksAmount] = useState(0)
    const [storyPointsAmount, setStoryPointsAmount] = useState(0)

    const todayDate = moment().startOf('day')
    const todayTimestampStartOfDay = todayDate.valueOf()

    const milestoneDate = moment(milestoneTimestamp).endOf('day')
    const milestoneEndTimestamp = milestoneDate.valueOf()

    let milestoneInitialTimestamp = 0
    if (previousMilestoneTimestamp > 0) {
        const previousMilestoneDate = moment(previousMilestoneTimestamp).endOf('day')
        milestoneInitialTimestamp = previousMilestoneDate.valueOf()
    }

    const getDaysLeft = () => {
        if (milestoneEndTimestamp > todayTimestampStartOfDay) {
            const ONE_DAY_MILLISECONDS = 86400000
            const dateMillisecondsDifference = milestoneDate.diff(todayDate)
            const daysDifference = Math.floor(dateMillisecondsDifference / ONE_DAY_MILLISECONDS)
            return daysDifference
        }
        return 0
    }

    const updateStatistics = (amountOfTasks, amountOfPoints) => {
        setTasksAmount(amountOfTasks)
        setStoryPointsAmount(amountOfPoints)
    }

    useEffect(() => {
        const watcherKey = v4()
        Backend.watchMilestoneTasksStatistics(
            projectId,
            milestoneInitialTimestamp,
            milestoneEndTimestamp,
            inDone,
            watcherKey,
            updateStatistics
        )
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [projectId, milestoneInitialTimestamp, milestoneEndTimestamp, inDone])

    const daysLeft = inDone ? 0 : getDaysLeft()
    const amountTasks = tasksAmount + ` ${translate(tasksAmount !== 1 ? 'Tasks' : 'Task')}`
    const amountStoryPoints =
        storyPointsAmount + ` ${translate(storyPointsAmount !== 1 ? 'Story Points' : 'Story Point')}`
    const amountDaysLeft = daysLeft + ` ${translate(daysLeft !== 1 ? 'Days Left' : 'Day Left')}`
    const text =
        inDone || inBacklog
            ? `${amountTasks} · ${amountStoryPoints}`
            : `${amountTasks} · ${amountStoryPoints} · ${amountDaysLeft}`
    return (
        <View style={[localStyles.container, inBacklog && { marginLeft: 0 }]}>
            <Text style={localStyles.text}>{text}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 8,
        height: 20,
        justifyContent: 'flex-end',
    },
    text: {
        ...styles.caption2,
        color: colors.Text02,
    },
})
