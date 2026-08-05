import React from 'react'
import { View, StyleSheet } from 'react-native'
import { DragDropContext, Droppable } from 'react-beautiful-dnd'
import { useDispatch, useSelector } from 'react-redux'
import { orderBy } from 'lodash'

import DraggableSkill from './DraggableSkill'
import DraggableSkillActive from './DraggableSkillActive'
import { colors } from '../../../../../styles/global'
import { setSkillsByProject } from '../../../../../../redux/actions'
import Backend from '../../../../../../utils/BackendBridge'
import { BatchWrapper } from '../../../../../../functions/BatchWrapper/batchWrapper'

export default function DroppableList({ projectId, higherSkill }) {
    const dispatch = useDispatch()
    const skillsInProject = useSelector(state => state.skillsByProject[projectId])
    const skills = skillsInProject ? skillsInProject : []

    const sortSkills = (skills, startIndex, endIndex) => {
        const sortedList = [...skills]
        const [removed] = sortedList.splice(startIndex, 1)
        sortedList.splice(endIndex, 0, removed)
        return sortedList
    }

    const onDragEnd = result => {
        const { destination, source } = result
        if (!destination || destination.index === source.index) {
            return
        }

        const sortedList = sortSkills(skills, source.index, destination.index)
        let sortedSkills = []

        const batch = new BatchWrapper(Backend.getDb())
        for (let i = 0; i < sortedList.length; i++) {
            const skill = sortedList[i]
            const sortIndex = Backend.updateSkillSortIndex(projectId, skill.id, batch)
            sortedSkills.push({ ...skill, sortIndex })
        }
        batch.commit()
        sortedSkills = orderBy(sortedSkills, 'sortIndex', 'asc')
        dispatch(setSkillsByProject(projectId, sortedSkills))
    }

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <Droppable
                droppableId={projectId}
                type={'skills'}
                renderClone={(provided, snapshot, rubric) => (
                    <DraggableSkillActive
                        projectId={projectId}
                        skill={skills[rubric.source.index]}
                        provided={provided}
                        isDragging={snapshot.isDragging}
                        higherSkill={higherSkill}
                    />
                )}
            >
                {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                        <View style={snapshot.isDraggingOver && localStyle.droppable}>
                            {skills.map((skill, index) => (
                                <DraggableSkill
                                    key={skill.id}
                                    projectId={projectId}
                                    skill={skill}
                                    index={index}
                                    higherSkill={higherSkill}
                                />
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
