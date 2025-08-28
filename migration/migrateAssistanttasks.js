// migrationScript.js
const admin = require('firebase-admin')

// ---- CONFIGURATION ----
// Path to your Firebase service account key JSON file
const serviceAccountPath = '../functions/service_accounts/alldonealeph-firebase-adminsdk-mpg7p-1c3e6a2555.json'
// Initialize Firebase Admin SDK
try {
    const serviceAccount = require(serviceAccountPath)
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    })
} catch (error) {
    console.error(
        'Failed to initialize Firebase Admin SDK. Ensure serviceAccountPath is correct and the file exists.',
        error
    )
    process.exit(1)
}

const db = admin.firestore()
const BATCH_SIZE = 400 // Firestore batch limit is 500 operations

async function migrateAssistantTasks() {
    console.log('Starting assistant tasks migration and update...')

    try {
        const projectsSnapshot = await db.collection('projects').get()
        if (projectsSnapshot.empty) {
            console.log('No projects found.')
            return
        }

        console.log(`Found ${projectsSnapshot.docs.length} projects.`)

        for (const projectDoc of projectsSnapshot.docs) {
            const projectId = projectDoc.id
            console.log(`\nProcessing project: ${projectId}`)

            const assistantTasksRootRef = db.collection('assistantTasks').doc(projectId)
            const preConfigTasksCollectionRef = assistantTasksRootRef.collection('preConfigTasks')
            const assistantSubCollections = await assistantTasksRootRef.listCollections()

            if (assistantSubCollections.length === 0) {
                console.log(
                    `  No assistant subcollections found under assistantTasks/${projectId}. Proceeding to update existing preConfigTasks.`
                )
            } else {
                for (const assistantCollectionRef of assistantSubCollections) {
                    const assistantId = assistantCollectionRef.id

                    if (assistantId === 'preConfigTasks') {
                        console.log(
                            `  Skipping 'preConfigTasks' collection in this phase for project ${projectId}. It will be processed for 'order' field later.`
                        )
                        continue
                    }

                    console.log(`  Processing old assistant structure: ${assistantId}`)

                    // Check if migration for this assistantId already happened
                    const migrationCheckSnapshot = await preConfigTasksCollectionRef
                        .where('assistantId', '==', assistantId)
                        .limit(1)
                        .get()

                    if (!migrationCheckSnapshot.empty) {
                        console.log(
                            `    Tasks for assistant ${assistantId} appear to be already migrated to preConfigTasks. Skipping migration for this assistant.`
                        )
                        continue
                    }

                    const oldTasksSnapshot = await assistantCollectionRef.get()

                    if (oldTasksSnapshot.empty) {
                        console.log(`    No tasks found for assistant ${assistantId} in old structure. Skipping.`)
                        continue
                    }

                    console.log(
                        `    Found ${oldTasksSnapshot.docs.length} tasks to migrate for assistant ${assistantId}.`
                    )
                    let batch = db.batch()
                    let operationsInBatch = 0

                    for (const taskDoc of oldTasksSnapshot.docs) {
                        const taskId = taskDoc.id
                        const taskData = taskDoc.data()

                        const newTaskData = {
                            ...taskData,
                            assistantId: assistantId,
                            order: 1, // Add order field during migration
                        }

                        const newTaskRef = preConfigTasksCollectionRef.doc(taskId)
                        batch.set(newTaskRef, newTaskData)
                        operationsInBatch++

                        // Optional: Delete old task document
                        // batch.delete(taskDoc.ref);
                        // operationsInBatch++;

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
            }

            // After potential migration, update all tasks in preConfigTasks to ensure 'order: 1'
            console.log(`  Updating 'order' field for all tasks in preConfigTasks for project ${projectId}...`)
            const allPreConfigTasksSnapshot = await preConfigTasksCollectionRef.get()

            if (allPreConfigTasksSnapshot.empty) {
                console.log(`    No tasks found in preConfigTasks for project ${projectId} to update 'order' field.`)
            } else {
                console.log(
                    `    Found ${allPreConfigTasksSnapshot.docs.length} tasks in preConfigTasks to check/update 'order' field.`
                )
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
                console.log(`  Finished updating 'order' field for preConfigTasks in project ${projectId}.`)
            }
            console.log(`Finished processing project: ${projectId}`)
        }
        console.log('\nMigration and update script completed successfully!')
    } catch (error) {
        console.error('Error during migration and update:', error)
    }
}

migrateAssistantTasks()
    .then(() => {
        console.log('Migration script finished execution.')
    })
    .catch(err => {
        console.error('Unhandled error in migration script:', err)
    })
