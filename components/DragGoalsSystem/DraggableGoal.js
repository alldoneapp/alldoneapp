import React from 'react'
import { View } from 'react-native'
import { Draggable } from 'react-beautiful-dnd'
import GoalItemPresentation from '../GoalsView/GoalItemPresentation'

const DraggableGoal = ({ projectId, goal, index }) => {
    return (
        <Draggable draggableId={goal.id} index={index}>
            {provided => (
                <div {...provided.draggableProps} ref={provided.innerRef} {...provided.dragHandleProps}>
                    <View style={{ backgroundColor: '#ffffff' }}>
                        <GoalItemPresentation
                            projectId={projectId}
                            goal={goal}
                            activeDragGoalMode={true}
                            provided={provided}
                        />
                    </View>
                </div>
            )}
        </Draggable>
    )
}

export default DraggableGoal
