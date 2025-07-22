import React from 'react'

import { dismissAllPopups } from '../../../../../utils/HelperFunctions'
import DismissibleItem from '../../../../UIComponents/DismissibleItem'
import EditSkill from './EditSkill'
import SkillPresentation from './SkillPresentation'

export default function SkillItem({
    projectId,
    skill,
    higherSkill,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    refKey,
}) {
    const setRef = ref => {
        setDismissibleRefs(ref, refKey)
    }

    const openEditionMode = () => {
        openEdition(refKey)
        setTimeout(() => {
            dismissAllPopups()
        })
    }

    const closeEditionMode = () => {
        closeEdition(refKey)
    }
    return (
        <DismissibleItem
            ref={setRef}
            defaultComponent={
                <SkillPresentation
                    projectId={projectId}
                    skill={skill}
                    higherSkill={higherSkill}
                    onPress={openEditionMode}
                />
            }
            modalComponent={
                <EditSkill
                    refKey={refKey}
                    projectId={projectId}
                    adding={false}
                    skill={skill}
                    onCancelAction={closeEditionMode}
                />
            }
        />
    )
}
