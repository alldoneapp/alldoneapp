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
    console.log('🎨 setProjectAssistant called:', { projectId, assistantId, needGenerateUpdate })

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
    await batch.commit()

    // Automatically set as default if this is the user's default project
    const { loggedUser } = store.getState()
    const isDefaultProject = assistantId && loggedUser?.defaultProjectId === projectId

    console.log('🔍 Checking if should auto-set as default:', {
        projectId,
        assistantId,
        defaultProjectId: loggedUser?.defaultProjectId,
        isDefaultProject,
    })

    if (isDefaultProject) {
        const { projectAssistants, globalAssistants } = store.getState()
        const isProjectAssistant = projectAssistants[projectId]?.some(a => a.uid === assistantId)
        const isGlobalAssistant = globalAssistants?.some(a => a.uid === assistantId)

        console.log('🔎 Assistant type check:', {
            assistantId,
            isProjectAssistant,
            isGlobalAssistant,
        })

        if (isProjectAssistant) {
            // For project assistants, set isDefault: true in the document
            console.log('✨ Auto-setting project assistant as default')
            const { setAssistantLikeDefault } = require('../Assistants/assistantsFirestore')
            setAssistantLikeDefault(projectId, assistantId)
        } else if (isGlobalAssistant) {
            // For global assistants, just setting project.assistantId is enough
            // The getDefaultAssistant function will pick it up from there
            console.log('✨ Global assistant set as project assistant (will be used as default)')
        } else {
            console.log('⚠️  Unknown assistant type')
        }
    } else {
        console.log('ℹ️  Not auto-setting as default (not the default project)')
    }
}

// Helper function to generate project prefix from project name
export function generateProjectPrefix(projectName) {
    if (!projectName || projectName.length === 0) {
        return 'TA' // Default fallback
    }

    // Remove non-alphabetic characters and get first and last letters
    const cleanName = projectName.replace(/[^a-zA-Z]/g, '')

    if (cleanName.length === 0) {
        return 'TA' // Fallback if no letters found
    }

    // Get first and last letters, convert to uppercase
    let prefix
    if (cleanName.length === 1) {
        prefix = cleanName + 'A' // If only one letter, append 'A'
    } else {
        prefix = (cleanName[0] + cleanName[cleanName.length - 1]).toUpperCase()
    }
    return prefix
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
