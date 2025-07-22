import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import GoalItemPresentation from '../GoalsView/GoalItemPresentation'

const DraggableGoalActive = ({ projectId, goal, provided, isDragging }) => {
    return (
        <div {...provided.draggableProps} ref={provided.innerRef}>
            <View style={isDragging && localStyle.shadowGoal}>
                <GoalItemPresentation projectId={projectId} goal={goal} activeDragGoalMode={true} provided={provided} />
            </View>
        </div>
    )
}

const localStyle = StyleSheet.create({
    shadowGoal: {
        borderRadius: 4,
        backgroundColor: '#ffffff',
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${8}px ${16}px rgba(0,0,0,0.04), ${0}px ${4}px ${8}px rgba(0,0,0,0.04)`,
            },
        }),
    },
})

export default DraggableGoalActive
