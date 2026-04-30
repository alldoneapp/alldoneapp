'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createProjectDescriptionChangedFeed } = require('../Feeds/projectsFeeds')
const { UserHelper } = require('./UserHelper')

function normalizeProjectDescription(value) {
    return typeof value === 'string' ? value.trim() : ''
}

async function updateProjectDescription({ db, projectId, userId, description, feedUser: actorFeedUser = null }) {
    if (!db) {
        throw new Error('Database instance is required')
    }

    if (!projectId || typeof projectId !== 'string') {
        throw new Error('Valid projectId is required')
    }

    if (!userId || typeof userId !== 'string') {
        throw new Error('Valid userId is required')
    }

    const normalizedDescription = normalizeProjectDescription(description)
    if (!normalizedDescription) {
        throw new Error('description is required for update_project_description.')
    }

    const projectRef = db.collection('projects').doc(projectId)
    const projectDoc = await projectRef.get()

    if (!projectDoc.exists) {
        throw new Error(`Project "${projectId}" was not found.`)
    }

    const projectData = projectDoc.data() || {}
    const currentDescription = normalizeProjectDescription(projectData.description)
    const projectName = projectData.name || projectId

    if (currentDescription === normalizedDescription) {
        return {
            success: true,
            updated: false,
            project: { id: projectId, name: projectName },
            description: normalizedDescription,
            previousDescription: currentDescription,
            message: `Project description is already up to date in project "${projectName}"`,
        }
    }

    const feedUser = actorFeedUser || (await UserHelper.getFeedUserData(db, userId))
    const batch = new BatchWrapper(db)

    batch.update(db.doc(`projects/${projectId}`), { description: normalizedDescription })
    await createProjectDescriptionChangedFeed(
        projectId,
        { ...projectData, description: normalizedDescription },
        normalizedDescription,
        currentDescription,
        batch,
        feedUser,
        false
    )
    await batch.commit()

    return {
        success: true,
        updated: true,
        project: { id: projectId, name: projectName },
        description: normalizedDescription,
        previousDescription: currentDescription,
        message: `Project description updated in project "${projectName}"`,
    }
}

module.exports = {
    normalizeProjectDescription,
    updateProjectDescription,
}
