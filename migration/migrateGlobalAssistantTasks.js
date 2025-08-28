const admin = require('firebase-admin')

// ---- CONFIGURATION ----
// Path to your Firebase service account key JSON file
const serviceAccountPath = '../functions/service_accounts/alldonealeph-firebase-adminsdk-mpg7p-1c3e6a2555.json'
// const serviceAccountPath = '../functions/service_accounts/alldonestaging-firebase-adminsdk-9idaq-d0cc414fbc.json'
// Initialize Firebase Admin SDK
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
const BATCH_SIZE = 400 // Firestore batch limit is 500 operations

async function migrateGlobalAssistantTasks() {
    console.log('Starting global assistants migration...')
    const projectId = 'globalProject'
    const assistantTasksRootRef = db.collection('assistantTasks').doc(projectId)
    const preConfigTasksCollectionRef = assistantTasksRootRef.collection('preConfigTasks')

    try {
        const assistantSubCollections = await assistantTasksRootRef.listCollections()
        if (assistantSubCollections.length === 0) {
            console.log('No assistant subcollections found under assistantTasks/globalProject.')
            return
        }

        for (const assistantCollectionRef of assistantSubCollections) {
            const assistantId = assistantCollectionRef.id
            if (assistantId === 'preConfigTasks') {
                console.log(`  Skipping 'preConfigTasks' collection.`)
                continue
            }

            // Check if already migrated
            const migrationCheckSnapshot = await preConfigTasksCollectionRef
                .where('assistantId', '==', assistantId)
                .limit(1)
                .get()
            if (!migrationCheckSnapshot.empty) {
                console.log(`    Tasks for assistant ${assistantId} appear to be already migrated. Skipping.`)
                continue
            }

            const oldTasksSnapshot = await assistantCollectionRef.get()
            if (oldTasksSnapshot.empty) {
                console.log(`    No tasks found for assistant ${assistantId}. Skipping.`)
                continue
            }

            console.log(`    Found ${oldTasksSnapshot.docs.length} tasks to migrate for assistant ${assistantId}.`)
            let batch = db.batch()
            let operationsInBatch = 0

            for (const taskDoc of oldTasksSnapshot.docs) {
                const taskId = taskDoc.id
                const taskData = taskDoc.data()
                const newTaskData = {
                    ...taskData,
                    assistantId: assistantId,
                    order: 1,
                }
                const newTaskRef = preConfigTasksCollectionRef.doc(taskId)
                batch.set(newTaskRef, newTaskData)
                operationsInBatch++
                // Optional: Delete old task document
                // batch.delete(taskDoc.ref)
                // operationsInBatch++
                if (operationsInBatch >= BATCH_SIZE) {
                    console.log(
                        `    Committing migration batch of ${operationsInBatch} ops for assistant ${assistantId}...`
                    )
                    await batch.commit()
                    batch = db.batch()
                    operationsInBatch = 0
                    console.log(`    Migration batch committed.`)
                }
            }
            if (operationsInBatch > 0) {
                console.log(
                    `    Committing final migration batch of ${operationsInBatch} ops for assistant ${assistantId}...`
                )
                await batch.commit()
                console.log(`    Final migration batch committed.`)
            }
            console.log(`    Finished migrating tasks for assistant ${assistantId}.`)
        }

        // After migration, ensure all preConfigTasks have order: 1
        console.log(`  Updating 'order' field for all tasks in preConfigTasks for globalProject...`)
        const allPreConfigTasksSnapshot = await preConfigTasksCollectionRef.get()
        if (allPreConfigTasksSnapshot.empty) {
            console.log(`    No tasks found in preConfigTasks to update 'order' field.`)
        } else {
            let updateBatch = db.batch()
            let updateOpsInBatch = 0
            for (const taskDoc of allPreConfigTasksSnapshot.docs) {
                const taskData = taskDoc.data()
                if (taskData.order !== 1) {
                    updateBatch.update(taskDoc.ref, { order: 1 })
                    updateOpsInBatch++
                    if (updateOpsInBatch >= BATCH_SIZE) {
                        console.log(`    Committing 'order' update batch of ${updateOpsInBatch} operations...`)
                        await updateBatch.commit()
                        updateBatch = db.batch()
                        updateOpsInBatch = 0
                        console.log(`    'order' update batch committed.`)
                    }
                }
            }
            if (updateOpsInBatch > 0) {
                console.log(`    Committing final 'order' update batch of ${updateOpsInBatch} operations...`)
                await updateBatch.commit()
                console.log(`    Final 'order' update batch committed.`)
            }
            console.log(`  Finished updating 'order' field for preConfigTasks in globalProject.`)
        }
        console.log('Global assistants migration completed successfully!')
    } catch (error) {
        console.error('Error during global assistants migration:', error)
    }
}

migrateGlobalAssistantTasks()
    .then(() => {
        console.log('Global assistants migration script finished execution.')
    })
    .catch(err => {
        console.error('Unhandled error in global assistants migration script:', err)
    })
