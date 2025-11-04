const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createTaskUpdatedFeed } = require('../Feeds/tasksFeeds')
const { FEED_TASK_ALERT_CHANGED } = require('../Feeds/FeedsConstants')

/**
 * Checks for tasks with alert times that have been reached and generates notifications
 * Runs every 5 minutes via scheduled cloud function
 */
async function checkAndTriggerTaskAlerts() {
    console.log('🔔 Starting task alert check at:', new Date().toISOString())

    try {
        const db = admin.firestore()
        const now = Date.now()

        // Query all tasks across all projects where:
        // - alertEnabled is true
        // - dueDate (which contains the alert time) is in the past
        // - task is not done
        // - alert has not been triggered yet
        const tasksSnapshot = await db
            .collectionGroup('tasks')
            .where('alertEnabled', '==', true)
            .where('dueDate', '<=', now)
            .where('done', '==', false)
            .get()

        console.log(`📋 Found ${tasksSnapshot.size} tasks with alerts to process`)

        if (tasksSnapshot.empty) {
            console.log('✅ No tasks with alerts to process')
            return
        }

        const batch = new BatchWrapper(db)
        let processedCount = 0
        let skippedCount = 0

        for (const taskDoc of tasksSnapshot.docs) {
            try {
                const task = taskDoc.data()
                const taskId = taskDoc.id

                // Get projectId from the document reference path
                // Path structure: items/{projectId}/tasks/{taskId}
                const projectId = taskDoc.ref.parent.parent.id

                // Skip if already triggered (defensive check)
                if (task.alertTriggered === true) {
                    console.log(`⏭️ Skipping task ${taskId} - alert already triggered`)
                    skippedCount++
                    continue
                }

                console.log(`🔔 Processing alert for task: ${taskId} in project: ${projectId}`)
                console.log(`   Task name: ${task.name || 'Unnamed'}`)
                console.log(`   Alert time: ${new Date(task.dueDate).toISOString()}`)

                // Generate feed notification using existing infrastructure
                // The feed creator should be the task owner/assignee
                const feedUser = {
                    uid: task.userId || task.creatorId || 'system',
                    displayName: 'Alert Notification',
                }

                await createTaskUpdatedFeed(
                    projectId,
                    task,
                    taskId,
                    batch,
                    feedUser,
                    true, // needGenerateNotification = TRUE (this creates the red/grey bubbles)
                    {
                        feedType: FEED_TASK_ALERT_CHANGED,
                        entryText: 'alert time reached',
                    }
                )

                // Mark task as alertTriggered to prevent duplicate notifications
                batch.update(taskDoc.ref, {
                    alertTriggered: true,
                })

                processedCount++
            } catch (taskError) {
                console.error(`❌ Error processing task ${taskDoc.id}:`, {
                    error: taskError.message,
                    stack: taskError.stack,
                })
                // Continue processing other tasks even if one fails
            }
        }

        // Commit all changes
        await batch.commit()

        console.log(`✅ Task alert check completed:`, {
            total: tasksSnapshot.size,
            processed: processedCount,
            skipped: skippedCount,
            timestamp: new Date().toISOString(),
        })

        return {
            success: true,
            processed: processedCount,
            skipped: skippedCount,
        }
    } catch (error) {
        console.error('💥 CRITICAL ERROR in checkAndTriggerTaskAlerts:', {
            error: error.message,
            stack: error.stack,
            code: error.code,
        })
        throw error
    }
}

module.exports = {
    checkAndTriggerTaskAlerts,
}
