import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { generateDateHeaderTextInMyDaySection, getEstimationRealValue } from '../../../utils/EstimationHelper'
import { getEstimationToUse } from './MyDayOpenTasks/myDayOpenTasksHelper'
import DateHeaderMoreButton from '../Sorting/DateHeaderMoreButton'

export default function MyDayDateLine({ tasks, date, containerStyle }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

    const inOpenSection = taskViewToggleSection === 'Open'

    const generateText = () => {
        const estimationsByProject = {}

        tasks.forEach(task => {
            const { projectId } = task

            const { estimation } = getEstimationToUse(task, loggedUserId)
            const convertedEstimation = getEstimationRealValue(projectId, estimation)

            if (estimationsByProject[projectId]) {
                estimationsByProject[projectId] += convertedEstimation
            } else {
                estimationsByProject[projectId] = convertedEstimation
            }
        })

        const projectIds = Object.keys(estimationsByProject)
        const estimations = Object.values(estimationsByProject)

        return generateDateHeaderTextInMyDaySection(date, projectIds, estimations, tasks.length)
    }

    const text = generateText()

    return (
        <View style={[localStyles.container, containerStyle]}>
            <Text style={localStyles.text}>{text}</Text>
            {inOpenSection && <DateHeaderMoreButton />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'space-between',
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderRadius: 4,
        height: 24,
        alignItems: 'center',
    },
    text: {
        ...styles.overline,
        color: colors.Text02,
        zIndex: 1,
        paddingLeft: 12,
    },
})
