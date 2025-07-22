import React from 'react'
import { View } from 'react-native-web'

import ProjectHelper from '../../ProjectsSettings/ProjectHelper'
import SkillsByProject from './SkillsByProject/SkillsByProject'

export default function SkillsSelectedProject({
    projectId,
    userId,
    setDismissibleRefs,
    closeEdition,
    closeAllEdition,
    openEdition,
}) {
    const projectIndex = ProjectHelper.getProjectIndexById(projectId)

    return (
        <View style={{ marginTop: 7 }}>
            <SkillsByProject
                key={projectId}
                projectIndex={projectIndex}
                projectId={projectId}
                userId={userId}
                setDismissibleRefs={setDismissibleRefs}
                openEdition={openEdition}
                closeEdition={closeEdition}
                closeAllEdition={closeAllEdition}
            />
        </View>
    )
}
