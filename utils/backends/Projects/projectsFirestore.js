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
