const admin = require('firebase-admin')

// ---- CONFIGURATION ----
const serviceAccountPath = '../functions/service_accounts/alldonealeph-firebase-adminsdk-mpg7p-1c3e6a2555.json'
const BATCH_SIZE = 350
const DRY_RUN = false

const RECURRENCE_NEVER = 'never'

try {
    const serviceAccount = require(serviceAccountPath)
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        })
    }
} catch (error) {
    console.error(
        'Failed to initialize Firebase Admin SDK. Ensure serviceAccountPath is correct and the file exists.',
        error
    )
    process.exit(1)
}

const db = admin.firestore()

function normalizeRecurrenceByUser(task, projectMembers) {
    if (!task?.recurrence || task.recurrence === RECURRENCE_NEVER) return {}

    const source = task?.recurrenceByUser && typeof task.recurrenceByUser === 'object' ? task.recurrenceByUser : {}
    const normalized = {}

    Object.entries(source).forEach(([userId, recurrenceValue]) => {
        if (!userId || !projectMembers.has(userId)) return
        if (!recurrenceValue || recurrenceValue === RECURRENCE_NEVER) return
        normalized[userId] = recurrenceValue
    })

    return normalized
}

function normalizeActivatedUserIds(task, projectMembers, recurrenceByUser) {
    if (!task?.recurrence || task.recurrence === RECURRENCE_NEVER) return []

    const source = Array.isArray(task?.activatedUserIds) ? task.activatedUserIds.filter(Boolean) : []
    const recurrenceUsers = Object.keys(recurrenceByUser)
    const merged = [...new Set([...source, ...recurrenceUsers])]
    return merged.filter(userId => projectMembers.has(userId))
}

function normalizeLastExecutedByUser(task, projectMembers, activatedUserIds) {
    const source =
        task?.lastExecutedByUser && typeof task.lastExecutedByUser === 'object' ? task.lastExecutedByUser : {}
    const activatedSet = new Set(activatedUserIds)
    const normalized = {}

    Object.entries(source).forEach(([userId, lastExecuted]) => {
        if (!projectMembers.has(userId)) return
        if (!activatedSet.has(userId)) return
        if (typeof lastExecuted !== 'number') return
        normalized[userId] = lastExecuted
    })

    return normalized
}

function pickSetupUser(task, assistantCreatorId, projectMembers) {
    const candidates = [task?.activatorUserId, task?.creatorUserId, assistantCreatorId].filter(Boolean)
    return candidates.find(userId => projectMembers.has(userId)) || null
}

function hasDiff(prev, next) {
    return JSON.stringify(prev) !== JSON.stringify(next)
}

async function cleanupAssistantTaskActivations() {
    console.log('Starting assistant task activation cleanup...', { dryRun: DRY_RUN })

    const projectsSnapshot = await db.collection('projects').get()
    if (projectsSnapshot.empty) {
        console.log('No projects found.')
        return
    }

    let updatesCount = 0
    let scannedTasks = 0
    let skippedTasks = 0
    let operationsInBatch = 0
    let batch = db.batch()
    let scannedProjects = 0
    let scannedAssistants = 0

    const heartbeat = setInterval(() => {
        console.log('Cleanup heartbeat:', {
            scannedProjects,
            scannedAssistants,
            scannedTasks,
            updatesCount,
            pendingBatchOps: operationsInBatch,
            dryRun: DRY_RUN,
        })
    }, 10000)

    for (const projectDoc of projectsSnapshot.docs) {
        scannedProjects++
        const projectId = projectDoc.id
        const projectData = projectDoc.data() || {}
        const projectMembers = new Set(Array.isArray(projectData.userIds) ? projectData.userIds : [])

        if (projectMembers.size === 0) continue

        console.log('Processing project:', {
            projectId,
            projectIndex: scannedProjects,
            totalProjects: projectsSnapshot.docs.length,
            members: projectMembers.size,
        })

        const assistantsSnapshot = await db.collection(`assistants/${projectId}/items`).get()
        if (assistantsSnapshot.empty) continue

        for (const assistantDoc of assistantsSnapshot.docs) {
            scannedAssistants++
            const assistantId = assistantDoc.id
            const assistantCreatorId = assistantDoc.data()?.creatorId || null

            console.log('Processing assistant:', {
                projectId,
                assistantId,
                assistantIndex: scannedAssistants,
                assistantsInProject: assistantsSnapshot.docs.length,
            })

            const tasksSnapshot = await db.collection(`assistantTasks/${projectId}/${assistantId}`).get()
            if (tasksSnapshot.empty) continue

            for (const taskDoc of tasksSnapshot.docs) {
                scannedTasks++
                const task = taskDoc.data() || {}

                const isRecurring = !!task?.recurrence && task.recurrence !== RECURRENCE_NEVER
                if (!isRecurring) {
                    skippedTasks++
                }

                let recurrenceByUser = normalizeRecurrenceByUser(task, projectMembers)
                let activatedUserIds = normalizeActivatedUserIds(task, projectMembers, recurrenceByUser)
                const setupUser = pickSetupUser(task, assistantCreatorId, projectMembers)

                if (isRecurring && activatedUserIds.length === 0 && setupUser) {
                    recurrenceByUser = { [setupUser]: task.recurrence }
                    activatedUserIds = [setupUser]
                }

                const lastExecutedByUser = normalizeLastExecutedByUser(task, projectMembers, activatedUserIds)

                const nextCreatorUserId = projectMembers.has(task?.creatorUserId)
                    ? task.creatorUserId
                    : setupUser || task.creatorUserId || ''
                const nextActivatorUserId = projectMembers.has(task?.activatorUserId)
                    ? task.activatorUserId
                    : setupUser || task.activatorUserId || ''

                const updatePayload = {
                    activatedUserIds,
                    recurrenceByUser,
                    lastExecutedByUser,
                    creatorUserId: nextCreatorUserId,
                    activatorUserId: nextActivatorUserId,
                }

                const previousShape = {
                    activatedUserIds: Array.isArray(task.activatedUserIds) ? task.activatedUserIds : [],
                    recurrenceByUser:
                        task.recurrenceByUser && typeof task.recurrenceByUser === 'object' ? task.recurrenceByUser : {},
                    lastExecutedByUser:
                        task.lastExecutedByUser && typeof task.lastExecutedByUser === 'object'
                            ? task.lastExecutedByUser
                            : {},
                    creatorUserId: task.creatorUserId || '',
                    activatorUserId: task.activatorUserId || '',
                }

                if (!hasDiff(previousShape, updatePayload)) {
                    continue
                }

                updatesCount++

                if (DRY_RUN) {
                    console.log('[DRY_RUN] Would update task:', {
                        projectId,
                        assistantId,
                        taskId: taskDoc.id,
                        taskName: task.name,
                        updatePayload,
                    })
                    continue
                }

                batch.update(taskDoc.ref, updatePayload)
                operationsInBatch++

                if (operationsInBatch >= BATCH_SIZE) {
                    await batch.commit()
                    batch = db.batch()
                    operationsInBatch = 0
                    console.log('Committed cleanup batch.', { updatesCount })
                }
            }
        }
    }

    if (!DRY_RUN && operationsInBatch > 0) {
        await batch.commit()
    }

    clearInterval(heartbeat)

    console.log('Assistant task activation cleanup completed.', {
        scannedTasks,
        skippedTasks,
        updatesCount,
        dryRun: DRY_RUN,
    })
}

cleanupAssistantTaskActivations()
    .then(() => {
        console.log('Cleanup script finished.')
    })
    .catch(error => {
        console.error('Cleanup script failed:', error)
        process.exit(1)
    })
