import React from 'react'

import DeleteContentItem from './DeleteContentItem'
import UsersArea from './UsersArea'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function Options({ projectId, userId, selectedUserId, setSelectedUserId, inProgress }) {
    const project = ProjectHelper.getProjectById(projectId)
    const isGuide = project && !!project.parentTemplateId
    return (
        <>
            <DeleteContentItem
                userId={userId}
                selectedUserId={selectedUserId}
                setSelectedUserId={setSelectedUserId}
                inProgress={inProgress}
            />
            {false && !isGuide && (
                <UsersArea
                    projectId={projectId}
                    userId={userId}
                    selectedUserId={selectedUserId}
                    setSelectedUserId={setSelectedUserId}
                    inProgress={inProgress}
                />
            )}
        </>
    )
}
