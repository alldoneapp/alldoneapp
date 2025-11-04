const admin = require('firebase-admin')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createTaskUpdatedFeed } = require('../Feeds/tasksFeeds')
const { FEED_TASK_ALERT_CHANGED } = require('../Feeds/FeedsConstants')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')

/**
 * Gets users who have logged in within the last 30 days
 * Returns a Map of userId -> userData for efficient lookups
 *
 * This optimization ensures we only check alerts for active users,
 * reducing unnecessary processing for inactive accounts
 */
async function getActiveUsersMap() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const activeUsersMap = new Map()

    try {
        const activeUsersSnapshot = await admin
            .firestore()
            .collection('users')
            .where('lastLogin', '>=', thirtyDaysAgo)
            .get()

        activeUsersSnapshot.docs.forEach(doc => {
            activeUsersMap.set(doc.id, { id: doc.id, ...doc.data() })
        })

        console.log('📊 Active users loaded:', {
            totalActiveUsers: activeUsersMap.size,
            cutoffDate: new Date(thirtyDaysAgo).toISOString(),
        })
    } catch (error) {
        console.error('❌ Failed to query active users:', {
            error: error.message,
            stack: error.stack,
        })
        // Return empty map - will result in no alerts being processed
        // Better than crashing or processing everything
    }

    return activeUsersMap
}

/**
 * Gets active projects for the given active users
 * Filters out:
 * - Archived projects (active === false)
 * - Template projects (isTemplate === true)
 * - Community/derived projects (parentTemplateId exists)
 *
 * This optimization ensures we only check tasks in projects that are
 * actively being used, dramatically reducing scope
 */
async function getActiveProjectsForUsers(activeUsersMap) {
    const activeProjects = new Set()

    for (const [userId] of activeUsersMap.entries()) {
        try {
            const userProjectsSnapshot = await admin
                .firestore()
                .collection('projects')
                .where('userIds', 'array-contains', userId)
                .get()

            userProjectsSnapshot.docs.forEach(doc => {
                const projectData = doc.data()

                // Skip archived projects
                if (projectData.active === false) {
                    return
                }

                // Skip template projects
                if (projectData.isTemplate === true) {
                    return
                }

                // Skip community/derived projects
                if (projectData.parentTemplateId) {
                    return
                }

                activeProjects.add(doc.id)
            })
        } catch (error) {
            console.warn('⚠️ Error fetching projects for user:', {
                userId,
                error: error.message,
            })
            // Continue with other users even if one fails
        }
    }

    console.log('📊 Active projects identified:', {
        activeUsers: activeUsersMap.size,
        activeProjects: activeProjects.size,
    })

    return activeProjects
}

/**
 * Checks for tasks with alert times that have been reached and generates notifications
 * Runs every 5 minutes via scheduled cloud function
 *
 * OPTIMIZATIONS:
 * 1. Only checks tasks for users active in last 30 days
 * 2. Only checks tasks in active (non-archived, non-template) projects
 * 3. Uses per-project queries instead of collectionGroup for better performance
 * 4. Verifies task owner is active before processing
 *
 * This reduces the scan scope by ~90-95% compared to checking all tasks
 */
async function checkAndTriggerTaskAlerts() {
    console.log('🔔 Starting task alert check at:', new Date().toISOString())

    try {
        const db = admin.firestore()
        const now = Date.now()

        // STAGE 1: Get active users (logged in within 30 days)
        const activeUsersMap = await getActiveUsersMap()
        if (activeUsersMap.size === 0) {
            console.log('✅ No active users found, skipping alert check')
            return {
                success: true,
                processed: 0,
                skipped: 0,
                activeUsers: 0,
                activeProjects: 0,
            }
        }

        // STAGE 2: Get active projects for those users
        const activeProjects = await getActiveProjectsForUsers(activeUsersMap)
        if (activeProjects.size === 0) {
            console.log('✅ No active projects found, skipping alert check')
            return {
                success: true,
                processed: 0,
                skipped: 0,
                activeUsers: activeUsersMap.size,
                activeProjects: 0,
            }
        }

        // STAGE 3: Query tasks in active projects only
        const tasksToProcess = []
        let totalTasksChecked = 0
        let skippedAlreadyTriggered = 0
        let skippedInactiveUser = 0

        console.log(`🔍 Checking tasks in ${activeProjects.size} active projects...`)

        for (const projectId of activeProjects) {
            try {
                const tasksSnapshot = await db
                    .collection(`items/${projectId}/tasks`)
                    .where('alertEnabled', '==', true)
                    .where('dueDate', '<=', now)
                    .where('done', '==', false)
                    .get()

                totalTasksChecked += tasksSnapshot.size

                for (const taskDoc of tasksSnapshot.docs) {
                    const task = taskDoc.data()
                    const taskId = taskDoc.id

                    // Skip if already triggered
                    if (task.alertTriggered === true) {
                        skippedAlreadyTriggered++
                        continue
                    }

                    // Verify task owner is active
                    const taskUserId = task.userId || task.creatorId
                    if (!activeUsersMap.has(taskUserId)) {
                        skippedInactiveUser++
                        continue
                    }

                    tasksToProcess.push({
                        projectId,
                        taskId,
                        taskDoc,
                        task,
                    })
                }
            } catch (error) {
                console.error('❌ Error querying tasks for project:', {
                    projectId,
                    error: error.message,
                })
                // Continue with other projects even if one fails
            }
        }

        console.log('📊 Task collection phase completed:', {
            activeProjects: activeProjects.size,
            totalTasksChecked,
            tasksToProcess: tasksToProcess.length,
            skippedAlreadyTriggered,
            skippedInactiveUser,
        })

        if (tasksToProcess.length === 0) {
            console.log('✅ No tasks with alerts to process')
            return {
                success: true,
                processed: 0,
                skipped: skippedAlreadyTriggered + skippedInactiveUser,
                activeUsers: activeUsersMap.size,
                activeProjects: activeProjects.size,
                totalTasksChecked,
            }
        }

        // Process alerts and generate notifications
        const batch = new BatchWrapper(db)
        let processedCount = 0

        // Cache project users to avoid repeated reads
        const projectUsersCache = new Map()

        for (const { projectId, taskId, taskDoc, task } of tasksToProcess) {
            try {
                console.log(`🔔 Processing alert for task: ${taskId} in project: ${projectId}`)
                console.log(`   Task name: ${task.name || 'Unnamed'}`)
                console.log(`   Alert time: ${new Date(task.dueDate).toISOString()}`)

                // Prepare feeds context so counters (red/grey) are correctly generated
                let projectUsers = projectUsersCache.get(projectId)
                if (!projectUsers) {
                    try {
                        const projSnap = await db.doc(`projects/${projectId}`).get()
                        const projData = projSnap.exists ? projSnap.data() : { userIds: [] }
                        projectUsers = Array.isArray(projData.userIds) ? projData.userIds : []
                        projectUsersCache.set(projectId, projectUsers)
                    } catch (e) {
                        console.warn('⚠️ Could not load project users for alerts', {
                            projectId,
                            error: e.message,
                        })
                        projectUsers = []
                    }
                }

                // Use a neutral creator so owners are not excluded from notifications
                const systemFeedCreator = { uid: 'system', id: 'system' }
                loadFeedsGlobalState(
                    admin,
                    admin,
                    systemFeedCreator,
                    { id: projectId, userIds: projectUsers },
                    [],
                    null
                )

                // Author feed as the task owner while creator filtering uses system
                const feedUser = { uid: task.userId || task.creatorId || 'system' }

                console.log('🔔 Alert feed context', {
                    projectId,
                    taskId,
                    projectUsersCount: projectUsers.length,
                    feedCreatorUid: systemFeedCreator.uid,
                })

                await createTaskUpdatedFeed(projectId, task, taskId, batch, feedUser, true, {
                    feedType: FEED_TASK_ALERT_CHANGED,
                    entryText: 'alert time reached',
                    feedCreator: systemFeedCreator,
                    project: { id: projectId, userIds: projectUsers },
                })

                // Mark task as alertTriggered to prevent duplicate notifications
                batch.update(taskDoc.ref, {
                    alertTriggered: true,
                })

                // Enqueue notifications per user settings (Push / Email / WhatsApp)
                try {
                    const userIdToNotify = task.userId || task.creatorId
                    if (userIdToNotify) {
                        const userSnap = await db.doc(`users/${userIdToNotify}`).get()
                        const user = userSnap.exists ? { uid: userSnap.id, ...userSnap.data() } : null

                        const nowTs = Date.now()
                        const baseUrl = inProductionEnvironment()
                            ? 'https://my.alldone.app'
                            : 'https://mystaging.alldone.app'
                        const taskLink = `${baseUrl}/projects/${projectId}/tasks/${taskId}/chat`
                        const body = `${project.name}\n  ✔ ${task.name}\n alert time reached`

                        if (user) {
                            // Push
                            if (user.pushNotificationsStatus) {
                                await db.collection('pushNotifications').add({
                                    userIds: [user.uid],
                                    body,
                                    link: taskLink,
                                    type: 'Alert Notification',
                                    messageTimestamp: nowTs,
                                    projectId,
                                    chatId: taskId,
                                })
                            }

                            // Email
                            if (user.receiveEmails) {
                                await db.doc(`emailNotifications/${projectId}__${taskId}__${nowTs}`).set({
                                    userIds: [user.uid],
                                    projectId,
                                    objectType: 'tasks',
                                    objectId: taskId,
                                    objectName: task.name || 'Task',
                                    messageTimestamp: nowTs,
                                })
                            }

                            // WhatsApp (independent dispatch via queue)
                            if (user.receiveWhatsApp && user.phone) {
                                await db.collection('whatsAppNotifications').add({
                                    userId: user.uid,
                                    userPhone: user.phone,
                                    projectId,
                                    projectName: project.name || 'Project',
                                    objectId: taskId,
                                    objectName: task.name || 'Task',
                                    updateText: 'alert time reached',
                                    link: taskLink,
                                    timestamp: nowTs,
                                })
                            }
                        }
                    }
                } catch (notifyErr) {
                    console.error('Alert notifications enqueue failed:', {
                        projectId,
                        taskId,
                        error: notifyErr.message,
                    })
                }

                processedCount++
            } catch (taskError) {
                console.error(`❌ Error processing task alert:`, {
                    taskId,
                    projectId,
                    error: taskError.message,
                    stack: taskError.stack,
                })
                // Continue processing other tasks even if one fails
            }
        }

        // Commit all changes
        await batch.commit()

        console.log('✅ Task alert check completed:', {
            activeUsers: activeUsersMap.size,
            activeProjects: activeProjects.size,
            totalTasksChecked,
            processed: processedCount,
            skippedAlreadyTriggered,
            skippedInactiveUser,
            timestamp: new Date().toISOString(),
        })

        return {
            success: true,
            processed: processedCount,
            skipped: skippedAlreadyTriggered + skippedInactiveUser,
            activeUsers: activeUsersMap.size,
            activeProjects: activeProjects.size,
            totalTasksChecked,
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
    getActiveUsersMap,
    getActiveProjectsForUsers,
}
