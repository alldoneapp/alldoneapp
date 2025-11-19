import { getDb } from '../firestore'
import store from '../../../redux/store'
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
        console.log(`[SomedayTask] Starting random selection. Percent: ${somedayTaskTriggerPercent}%`)

        // Check if we should trigger based on percentage
        if (!somedayTaskTriggerPercent) {
            console.log('[SomedayTask] Percentage is 0 or undefined, skipping.')
            return null
        }
        const triggerProbability = somedayTaskTriggerPercent / 100
        const randomValue = Math.random()
        if (randomValue >= triggerProbability) {
            console.log(
                `[SomedayTask] Skipped due to probability. Random: ${randomValue}, Trigger: ${triggerProbability}`
            )
            return null
        }

        console.log('[SomedayTask] Probability check passed. Fetching projects...')
        // Get all projects the user has access to
        const projectsSnapshot = await getDb()
            .collection('projects')
            .where('usersWithAccess', 'array-contains', userId)
            .get()

        if (projectsSnapshot.empty) {
            console.log('[SomedayTask] No projects found for user.')
            return null
        }

        // Collect all Someday tasks across all projects
        const somedayTasks = []
        console.log(`[SomedayTask] Scanning ${projectsSnapshot.size} projects...`)

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
                    projectName: project.name,
                    data: taskDoc.data(),
                })
            })
        }

        // If no Someday tasks found, return null
        if (somedayTasks.length === 0) {
            console.log('[SomedayTask] No Someday tasks found across all projects.')
            return null
        }

        console.log(`[SomedayTask] Found ${somedayTasks.length} Someday tasks candidates.`)

        // Randomly select one task
        const randomIndex = Math.floor(Math.random() * somedayTasks.length)
        const selectedTask = somedayTasks[randomIndex]

        console.log(
            `[SomedayTask] Selected task: "${selectedTask.data.name}" (${selectedTask.id}) in project: "${selectedTask.projectName}" (${selectedTask.projectId})`
        )

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
