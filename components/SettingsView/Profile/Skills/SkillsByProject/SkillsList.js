import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import NormalList from './NormalList'
import DroppableList from './Sorting/DroppableList'
import useActiveDragMode from '../useActiveDragMode'

export default function SkillsList({ projectId, setDismissibleRefs, openEdition, closeEdition }) {
    const skillsInProject = useSelector(state => state.skillsByProject[projectId])
    const activeDragMode = useActiveDragMode(projectId)

    const skills = skillsInProject ? skillsInProject : []

    const getHigherSkillPoints = () => {
        let higherSkill = 0
        skills.forEach(skill => {
            if (skill.points > higherSkill) higherSkill = skill.points
        })
        return higherSkill
    }

    const higherSkill = getHigherSkillPoints()

    return (
        skills.length > 0 && (
            <View style={localStyles.container}>
                {activeDragMode ? (
                    <DroppableList projectId={projectId} higherSkill={higherSkill} />
                ) : (
                    <NormalList
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        higherSkill={higherSkill}
                    />
                )}
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: { marginTop: 9 },
})
