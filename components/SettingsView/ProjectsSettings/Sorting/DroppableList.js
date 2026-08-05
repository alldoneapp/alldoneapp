import React from 'react'
import { View, StyleSheet } from 'react-native'
import { DragDropContext, Droppable } from 'react-beautiful-dnd'
import { useDispatch, useSelector } from 'react-redux'

import DraggableProject from './DraggableProject'
import DraggableProjectActive from './DraggableProjectActive'
import { colors } from '../../../styles/global'
import { BatchWrapper } from '../../../../functions/BatchWrapper/batchWrapper'
import { setProjectsSortIndex } from '../../../../redux/actions'
import { setProjectSortIndex } from '../../../../utils/backends/Projects/projectsFirestore'
import { generateSortIndex, getDb } from '../../../../utils/backends/firestore'

export default function DroppableList({ projects, projectType }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const sortProjects = (projects, startIndex, endIndex) => {
        const sortedList = [...projects]
        const [removed] = sortedList.splice(startIndex, 1)
        sortedList.splice(endIndex, 0, removed)
        return sortedList
    }

    const onDragEnd = result => {
        const { destination, source } = result
        if (!destination || destination.index === source.index) {
            return
        }

        const sortedList = sortProjects(projects, source.index, destination.index)

        const projectsMap = {}
        const batch = new BatchWrapper(getDb())
        for (let i = sortedList.length - 1; i >= 0; i--) {
            const project = sortedList[i]
            const sortIndex = generateSortIndex()
            setProjectSortIndex(project.id, loggedUserId, sortIndex, batch)
            projectsMap[project.id] = {
                ...project,
                sortIndexByUser: { ...project.sortIndexByUser, [loggedUserId]: sortIndex },
            }
        }
        batch.commit()

        dispatch(setProjectsSortIndex(projectsMap))
    }

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <Droppable
                droppableId={projectType}
                type={'projects'}
                renderClone={(provided, snapshot, rubric) => (
                    <DraggableProjectActive
                        project={projects[rubric.source.index]}
                        provided={provided}
                        isDragging={snapshot.isDragging}
                    />
                )}
            >
                {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                        <View style={snapshot.isDraggingOver && localStyle.droppable}>
                            {projects.map((project, index) => (
                                <DraggableProject key={project.id} project={project} index={index} />
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
