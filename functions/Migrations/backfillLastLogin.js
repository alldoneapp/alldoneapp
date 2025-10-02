/**
 * Migration script to backfill lastLogin field for all users
 *
 * This script adds lastLogin: 0 (epoch time) to all users who don't have this field.
 * This ensures the query where('lastLogin', '>=', threshold) works without FAILED_PRECONDITION error.
 *
 * Users with lastLogin: 0 will be considered inactive and filtered out by the 30-day activity check.
 */

const admin = require('firebase-admin')

/**
 * Backfill lastLogin field for all users missing it
 * @returns {Promise<Object>} - Summary of migration results
 */
async function backfillLastLogin() {
    const startTime = Date.now()
    console.log('🚀 Starting lastLogin backfill migration...')
    console.log(`Started at: ${new Date().toISOString()}`)

    let totalUsers = 0
    let usersWithLastLogin = 0
    let usersMissingLastLogin = 0
    let usersUpdated = 0
    let errors = 0

    try {
        // Fetch all users
        console.log('📥 Fetching all users from Firestore...')
        const usersSnapshot = await admin.firestore().collection('users').get()
        totalUsers = usersSnapshot.docs.length

        console.log(`✅ Found ${totalUsers} total users`)

        // Process users in batches of 500 (Firestore batch limit)
        const BATCH_SIZE = 500
        let batch = admin.firestore().batch()
        let batchCount = 0
        let operationsInCurrentBatch = 0

        for (let i = 0; i < usersSnapshot.docs.length; i++) {
            const userDoc = usersSnapshot.docs[i]
            const userData = userDoc.data()

            if (userData.lastLogin !== undefined && userData.lastLogin !== null) {
                usersWithLastLogin++
            } else {
                // User is missing lastLogin - add it
                usersMissingLastLogin++
                batch.update(userDoc.ref, { lastLogin: 0 })
                operationsInCurrentBatch++

                // Commit batch when we reach 500 operations
                if (operationsInCurrentBatch >= BATCH_SIZE) {
                    try {
                        await batch.commit()
                        usersUpdated += operationsInCurrentBatch
                        batchCount++
                        console.log(
                            `✅ Batch ${batchCount} committed: Updated ${operationsInCurrentBatch} users (Total: ${usersUpdated}/${usersMissingLastLogin})`
                        )

                        // Start new batch
                        batch = admin.firestore().batch()
                        operationsInCurrentBatch = 0
                    } catch (error) {
                        console.error(`❌ Error committing batch ${batchCount}:`, error.message)
                        errors++
                        // Start new batch anyway
                        batch = admin.firestore().batch()
                        operationsInCurrentBatch = 0
                    }
                }
            }

            // Progress update every 1000 users
            if ((i + 1) % 1000 === 0) {
                console.log(`📊 Progress: Processed ${i + 1}/${totalUsers} users`)
            }
        }

        // Commit remaining operations
        if (operationsInCurrentBatch > 0) {
            try {
                await batch.commit()
                usersUpdated += operationsInCurrentBatch
                batchCount++
                console.log(
                    `✅ Final batch ${batchCount} committed: Updated ${operationsInCurrentBatch} users (Total: ${usersUpdated}/${usersMissingLastLogin})`
                )
            } catch (error) {
                console.error(`❌ Error committing final batch:`, error.message)
                errors++
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2)

        const summary = {
            success: true,
            totalUsers,
            usersWithLastLogin,
            usersMissingLastLogin,
            usersUpdated,
            errors,
            batchesCommitted: batchCount,
            durationSeconds: parseFloat(duration),
            timestamp: new Date().toISOString(),
        }

        console.log('\n' + '='.repeat(60))
        console.log('📊 MIGRATION SUMMARY')
        console.log('='.repeat(60))
        console.log(`Total users: ${totalUsers}`)
        console.log(`Users with lastLogin: ${usersWithLastLogin}`)
        console.log(`Users missing lastLogin: ${usersMissingLastLogin}`)
        console.log(`Users updated: ${usersUpdated}`)
        console.log(`Errors: ${errors}`)
        console.log(`Batches committed: ${batchCount}`)
        console.log(`Duration: ${duration}s`)
        console.log('='.repeat(60))

        if (usersUpdated === usersMissingLastLogin && errors === 0) {
            console.log('✅ Migration completed successfully!')
        } else if (errors > 0) {
            console.log('⚠️  Migration completed with errors. Check logs above.')
        }

        return summary
    } catch (error) {
        console.error('❌ Migration failed with error:', error)
        return {
            success: false,
            error: error.message,
            stack: error.stack,
            totalUsers,
            usersWithLastLogin,
            usersMissingLastLogin,
            usersUpdated,
            errors: errors + 1,
            timestamp: new Date().toISOString(),
        }
    }
}

module.exports = {
    backfillLastLogin,
}
