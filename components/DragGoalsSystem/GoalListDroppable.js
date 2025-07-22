import React from 'react'
import { StyleSheet, View } from 'react-native'
import { DragDropContext, Droppable } from 'react-beautiful-dnd'
import { useDispatch } from 'react-redux'

import { colors } from '../styles/global'
import DraggableGoal from './DraggableGoal'
import DraggableGoalActive from './DraggableGoalActive'
import { DROPPABLE_SEPARATOR } from '../GoalsView/GoalsHelper'
import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import { setBoardGoalsByMilestoneInProject } from '../../redux/actions'
import { BatchWrapper } from '../../functions/BatchWrapper/batchWrapper'
export default function GoalListDroppable({ projectId, goalsList, milestoneId, userId, milestoneGoals }) {
    const dispatch = useDispatch()
    const sortGoals = (goalsList, startIndex, endIndex) => {
        const sortedList = [...goalsList]
        const [removed] = sortedList.splice(startIndex, 1)
        sortedList.splice(endIndex, 0, removed)
        return sortedList
    }

    const onDragEnd = result => {
        const { destination, source, draggableId } = result
        if (!destination || destination.index === source.index) {
            return
        }

        const droppableIds = source.droppableId.split(DROPPABLE_SEPARATOR)
        const milestoneId = droppableIds[0]

        const sortedList = sortGoals(goalsList, source.index, destination.index)

        const reverseSortedList = sortedList.reverse()

        const sortedMilestoneGoals = [...milestoneGoals]
        const batch = new BatchWrapper(Backend.getDb())
        for (let i = 0; i < reverseSortedList.length; i++) {
            const goal = reverseSortedList[i]
            const sortIndex = Backend.updateGoalSortIndexWithBatch(projectId, goal.id, milestoneId, batch)

            for (let n = 0; n < milestoneGoals.length; n++) {
                const milestoneGoal = milestoneGoals[n]

                if (milestoneGoal.id === goal.id) {
                    const milestoneGoalSortIndex = milestoneGoal.sortIndexByMilestone
                        ? milestoneGoal.sortIndexByMilestone
                        : {}
                    milestoneGoalSortIndex[milestoneId] = sortIndex
                    sortedMilestoneGoals[n] = { ...milestoneGoal, sortIndexByMilestone: milestoneGoalSortIndex }
                    break
                }
            }
        }

        const { boardGoalsByMilestoneByProject } = store.getState()
        const boardGoalsByMilestones = {
            ...boardGoalsByMilestoneByProject[projectId],
            [milestoneId]: sortedMilestoneGoals,
        }
        dispatch(setBoardGoalsByMilestoneInProject(projectId, boardGoalsByMilestones))
        batch.commit()
    }

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <Droppable
                droppableId={`${milestoneId}${DROPPABLE_SEPARATOR}${userId}`}
                type={`${milestoneId}@${userId}`}
                renderClone={(provided, snapshot, rubric) => (
                    <DraggableGoalActive
                        projectId={projectId}
                        goal={goalsList[rubric.source.index]}
                        provided={provided}
                        isDragging={snapshot.isDragging}
                    />
                )}
            >
                {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                        <View style={snapshot.isDraggingOver && localStyle.droppable}>
                            {goalsList.map((goal, index) => (
                                <DraggableGoal key={goal.id} projectId={projectId} goal={goal} index={index} />
                            ))}
                            {provided.placeholder}
                        </View>
                    </div>
                )}
            </Droppable>
        </DragDropContext>
    )
}

const localStyle = StyleSheet.create({
    droppable: {
        backgroundColor: colors.Grey300,
    },
})
