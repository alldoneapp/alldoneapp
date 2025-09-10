import moment from 'moment'

import { FOLLOWER_PROJECTS_TYPE } from '../../../components/Followers/FollowerConstants'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { getDb, tryAddFollower } from '../firestore'
import {
    createProjectAssistantChangedFeed,
    createProjectColorChangedFeed,
    createProjectEstimationTypeChangedFeed,
    createProjectSharedChangedFeed,
    createProjectTitleChangedFeed,
} from './projectUpdates'
import store from '../../../redux/store'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

export async function setProjectIsShared(project, newShared) {
    getDb().doc(`projects/${project.id}`).update({ isShared: newShared })

    const batch = new BatchWrapper(getDb())
    await createProjectSharedChangedFeed(project.id, project, newShared, project.isShared, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: project.id,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followProjectData, batch)
    batch.commit()
}

export async function setProjectEstimationType(project, newType) {
    getDb().doc(`projects/${project.id}`).update({ estimationType: newType })

    const batch = new BatchWrapper(getDb())
    await createProjectEstimationTypeChangedFeed(project.id, project, newType, project.estimationType, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: project.id,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followProjectData, batch)
    batch.commit()
}

export async function setProjectName(project, newTitle) {
    getDb().doc(`projects/${project.id}`).update({ name: newTitle })

    const batch = new BatchWrapper(getDb())
    await createProjectTitleChangedFeed(project.id, project, project.name, newTitle, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: project.id,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followProjectData, batch)
    batch.commit()
}

export async function setProjectColor(project, newColor) {
    getDb().doc(`projects/${project.id}`).update({ color: newColor })

    const batch = new BatchWrapper(getDb())
    await createProjectColorChangedFeed(project.id, project, project.color, newColor, batch)
    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: project.id,
        followObject: project,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(project.id, followProjectData, batch)
    batch.commit()
}

export function setProjectLastChatActionDate(projectId) {
    getDb().doc(`/projects/${projectId}`).update({
        lastChatActionDate: moment().valueOf(),
    })
}

export function setProjectAutoEstimation(projectId, autoEstimation) {
    getDb().doc(`/projects/${projectId}`).update({
        autoEstimation,
    })
}

export function setProjectSortIndex(projectId, userId, sortIndex, batch) {
    batch.update(getDb().doc(`/projects/${projectId}`), {
        [`sortIndexByUser.${userId}`]: sortIndex,
    })
}

export const setProjectAssistant = async (projectId, assistantId, needGenerateUpdate) => {
    getDb().doc(`projects/${projectId}`).update({ assistantId })

    const batch = new BatchWrapper(getDb())

    if (needGenerateUpdate) {
        await createProjectAssistantChangedFeed(projectId, batch)
    }

    const followProjectData = {
        followObjectsType: FOLLOWER_PROJECTS_TYPE,
        followObjectId: projectId,
        followObject: ProjectHelper.getProjectById(projectId),
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followProjectData, batch)
    batch.commit()
}

// Helper function to generate project prefix from project name
export function generateProjectPrefix(projectName) {
    if (!projectName || projectName.length === 0) {
        return 'TA' // Default fallback
    }

    // Remove non-alphabetic characters and get first 2 letters
    const cleanName = projectName.replace(/[^a-zA-Z]/g, '')

    if (cleanName.length === 0) {
        return 'TA' // Fallback if no letters found
    }

    // Get first 2 letters, convert to uppercase
    const prefix = cleanName.substring(0, 2).toUpperCase()
    return prefix.length === 1 ? prefix + 'A' : prefix
}

// Initialize task ID counter for a project if it doesn't exist
export async function initializeProjectTaskCounter(projectId) {
    const projectRef = getDb().doc(`projects/${projectId}`)

    try {
        await getDb().runTransaction(async transaction => {
            const projectDoc = await transaction.get(projectRef)

            if (projectDoc.exists && !projectDoc.data().hasOwnProperty('taskIdCounter')) {
                transaction.update(projectRef, { taskIdCounter: 0 })
            }
        })
    } catch (error) {
        console.error('Error initializing task counter for project:', projectId, error)
    }
}

// Generate next task ID for a project and increment counter
export async function getNextTaskId(projectId) {
    const projectRef = getDb().doc(`projects/${projectId}`)

    try {
        return await getDb().runTransaction(async transaction => {
            const projectDoc = await transaction.get(projectRef)

            if (!projectDoc.exists) {
                throw new Error(`Project ${projectId} not found`)
            }

            const projectData = projectDoc.data()
            const currentCounter = projectData.taskIdCounter || 0
            const nextCounter = currentCounter + 1

            // Update the counter
            transaction.update(projectRef, { taskIdCounter: nextCounter })

            // Generate the human-readable ID
            const prefix = generateProjectPrefix(projectData.name)
            const humanReadableId = `${prefix}-${nextCounter}`

            return humanReadableId
        })
    } catch (error) {
        console.error('Error generating task ID for project:', projectId, error)

        // Fallback strategy: try to get project data for prefix, use timestamp for number
        try {
            const projectDoc = await getDb().doc(`projects/${projectId}`).get()
            if (projectDoc.exists) {
                const prefix = generateProjectPrefix(projectDoc.data().name)
                const timestamp = Date.now().toString().slice(-4)
                return `${prefix}-${timestamp}`
            }
        } catch (fallbackError) {
            console.error('Error in fallback ID generation:', fallbackError)
        }

        // Ultimate fallback
        const timestamp = Date.now().toString().slice(-4)
        return `TA-${timestamp}`
    }
}
