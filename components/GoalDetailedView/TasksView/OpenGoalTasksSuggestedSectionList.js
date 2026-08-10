import React from 'react'
import { StyleSheet, View, Image, Text } from 'react-native'

import GoalTasksList from './GoalTasksList'
import { SUGGESTED_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import styles, { colors } from '../../styles/global'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'
import { translate } from '../../../i18n/TranslationService'

export default function OpenGoalTasksSuggestedSectionList({
    suggestedTasks,
    projectId,
    dateIndex,
    isActiveOrganizeMode,
}) {
    const { photoURL } = getUserPresentationData('')

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <Image source={{ uri: photoURL }} style={localStyles.logo} />
                    <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.caption1, { color: colors.Text03 }]}>{translate('Suggested')}</Text>
                    </View>
                </View>
            </View>
            <GoalTasksList
                projectId={projectId}
                taskList={suggestedTasks}
                dateIndex={dateIndex}
                taskListIndex={SUGGESTED_TASK_INDEX}
                isSuggested={true}
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
    logo: {
        width: 20,
        height: 20,
        borderRadius: 100,
    },
})
