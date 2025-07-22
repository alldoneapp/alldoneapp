import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import GoalTasksList from './GoalTasksList'
import { MENTION_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'

export default function GoalOpenTasksMentionSection({ mentionTasks, projectId, dateIndex, isActiveOrganizeMode }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <Icon name="at-sign" color={colors.UtilityGreen300} size={20} />
                    <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.caption1, { color: colors.Text03 }]}>{translate('mentioned')}</Text>
                    </View>
                </View>
            </View>

            <GoalTasksList
                projectId={projectId}
                taskList={mentionTasks}
                dateIndex={dateIndex}
                taskListIndex={MENTION_TASK_INDEX}
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
})
