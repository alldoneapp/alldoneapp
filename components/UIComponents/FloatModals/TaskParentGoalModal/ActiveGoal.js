import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { colors } from '../../../styles/global'
import ObjectHeaderParser from '../../../Feeds/TextParser/ObjectHeaderParser'
import AssigneesIcon from '../../../GoalsView/EditGoalsComponents/AssigneesIcon'
import GoalProgress from '../../../Feeds/CommentsTextInput/MentionsModal/GoalProgress'

export default function ActiveGoal({ unselectGoal, projectId, activeGoal, activeGoalRef, hover }) {
    const { extendedName, assigneesIds, progress } = activeGoal
    return (
        <View>
            <TouchableOpacity
                ref={ref => {
                    activeGoalRef.current = ref
                }}
                style={[localStyles.container, hover && localStyles.hover]}
                onPress={unselectGoal}
            >
                <GoalProgress projectId={projectId} progress={progress} />
                <ObjectHeaderParser
                    text={extendedName}
                    projectId={projectId}
                    entryExternalStyle={localStyles.text}
                    containerExternalStyle={localStyles.textContainer}
                    inMentionModal={true}
                    dotsBackgroundColor={{
                        backgroundColor: hover ? colors.UtilityGreen100 : colors.UtilityGreen200,
                    }}
                    disebledTags={true}
                    maxHeight={48}
                    shortTags={true}
                />
                {assigneesIds.length > 0 && (
                    <AssigneesIcon
                        assigneesIds={assigneesIds}
                        disableModal={true}
                        maxUsersToShow={1}
                        projectId={projectId}
                    />
                )}
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 8,
        backgroundColor: colors.UtilityGreen200,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityGreen100,
    },
    hover: {
        backgroundColor: colors.UtilityGreen200,
        borderColor: colors.Primary100,
        borderStyle: 'dashed',
    },
    text: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    textContainer: {
        maxHeight: 48,
        overflow: 'hidden',
        marginHorizontal: 8,
    },
})
