import { getDb } from '../firestore'
import store from '../../../store'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'
import moment from 'moment'

/**
 * Randomly selects a task from "Someday" across all projects and moves it to today
 * @param {string} userId - The user ID
 * @returns {Promise<Object|null>} The selected task object or null if no task was selected
 */
export async function selectRandomSomedayTask(userId) {
    try {
        const { somedayTaskTriggerPercent } = store.getState().loggedUser

        // Check if we should trigger based on percentage
        if (!somedayTaskTriggerPercent) return null
        const triggerProbability = somedayTaskTriggerPercent / 100
        if (Math.random() >= triggerProbability) {
            return null
        }

        // Get all projects the user has access to
        const projectsSnapshot = await getDb()
            .collection('projects')
            .where('usersWithAccess', 'array-contains', userId)
            .get()

        if (projectsSnapshot.empty) return null

        // Collect all Someday tasks across all projects
        const somedayTasks = []

        for (const projectDoc of projectsSnapshot.docs) {
            const projectId = projectDoc.id
            const project = projectDoc.data()

            // Skip template projects
            if (project.isTemplate) continue

            // Query for Someday tasks assigned to the user
            const tasksSnapshot = await getDb()
                .collection(`items/${projectId}/tasks`)
                .where('dueDate', '==', BACKLOG_DATE_NUMERIC)
                .where('done', '==', false)
                .where('currentReviewerId', '==', userId)
                .where('parentId', '==', null)
                .get()

            tasksSnapshot.docs.forEach(taskDoc => {
                somedayTasks.push({
                    id: taskDoc.id,
                    projectId,
                    data: taskDoc.data(),
                })
            })
        }

        // If no Someday tasks found, return null
        if (somedayTasks.length === 0) return null

        // Randomly select one task
        const randomIndex = Math.floor(Math.random() * somedayTasks.length)
        const selectedTask = somedayTasks[randomIndex]

        // Update the task's due date to today
        const todayDate = moment().startOf('day').valueOf()
        await getDb().doc(`items/${selectedTask.projectId}/tasks/${selectedTask.id}`).update({
            dueDate: todayDate,
            lastEditionDate: Date.now(),
            lastEditorId: userId,
            // Add a flag to indicate this was randomly selected
            randomlySelectedFromSomeday: true,
        })

        return {
            taskId: selectedTask.id,
            projectId: selectedTask.projectId,
            taskName: selectedTask.data.name,
        }
    } catch (error) {
        console.error('Error selecting random Someday task:', error)
        return null
    }
}
