import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import GoogleGmail from '../../../assets/svg/GoogleGmail'
import GoalTasksList from './GoalTasksList'
import { EMAIL_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'

export default function GoalOpenTasksEmailSection({ emailTasks, dateIndex, projectId, isActiveOrganizeMode }) {
    const openLink = () => {
        return window.open('https://mail.google.com/mail/u/?' + `authuser=${emailTasks[0].gmailData.email}`, '_blank')
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <TouchableOpacity onPress={openLink} style={{ flexDirection: 'row' }}>
                        <GoogleGmail />
                        <Text style={localStyles.title}>Google Gmail</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <GoalTasksList
                projectId={projectId}
                taskList={emailTasks}
                dateIndex={dateIndex}
                taskListIndex={EMAIL_TASK_INDEX}
                isActiveOrganizeMode={isActiveOrganizeMode}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
    subContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        marginTop: 52,
        paddingBottom: 2,
        paddingLeft: 2,
    },
    centeredRow: {
        flex: 1,
        maxHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
