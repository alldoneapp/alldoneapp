import { v4 } from 'uuid'
import { getDb } from '../firestore'
import store from '../../../redux/store'
import {
    ensureProjectFocusArea as ensureArea,
    renameProjectFocusArea as renameArea,
    getGoalFocusArea,
    resolveFocusAreaForProjectMove as resolveArea,
} from '../../../functions/shared/goalFocusAreas'

export const ensureProjectFocusArea = (projectId, name) => ensureArea(getDb(), projectId, name, v4())

export const renameProjectFocusArea = (projectId, areaId, name) => renameArea(getDb(), projectId, areaId, name)

export const setGoalFocusArea = async (projectId, goalId, focusAreaId) => {
    const db = getDb()
    await db.runTransaction(async transaction => {
        if (focusAreaId) {
            const project = await transaction.get(db.doc(`projects/${projectId}`))
            if (!getGoalFocusArea({ focusAreaId }, project.data()?.focusAreas)) {
                throw new Error('focus-area-not-found')
            }
        }
        transaction.update(db.doc(`goals/${projectId}/items/${goalId}`), {
            focusAreaId: focusAreaId || null,
            lastEditionDate: Date.now(),
            lastEditorId: store.getState().loggedUser.uid,
        })
    })
}

export const resolveFocusAreaForProjectMove = async (oldProjectId, newProjectId, goal) => {
    if (!goal.focusAreaId) return null
    const source = await getDb().doc(`projects/${oldProjectId}`).get()
    return resolveArea(getDb(), source.data(), newProjectId, goal, v4())
}
