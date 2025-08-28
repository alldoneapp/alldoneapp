import React from 'react'
import { useSelector } from 'react-redux'

import SkillItem from '../SkillItem/SkillItem'

export default function NormalList({ projectId, setDismissibleRefs, openEdition, closeEdition, higherSkill }) {
    const skillsInProject = useSelector(state => state.skillsByProject[projectId])
    const skills = skillsInProject ? skillsInProject : []

    return (
        <>
            {skills.map(skill => (
                <SkillItem
                    key={skill.id}
                    projectId={projectId}
                    skill={skill}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    refKey={skill.id}
                    higherSkill={higherSkill}
                />
            ))}
        </>
    )
}
