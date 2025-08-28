const functions = require('firebase-functions')
const admin = require('firebase-admin')
const { defineSecret } = require('firebase-functions/params')
const {
    stripeSecretKey,
    initializeStripe,
    checkPremiumStatusByEmail,
    checkPremiumStatus,
    PLAN_STATUS_FREE,
    PLAN_STATUS_PREMIUM,
} = require('../Payment/stripeHelperSecure')

/**
 * Updates user's premium status in Firestore based on Stripe subscription
 * @param {string} userId - User ID
 * @param {Object} premiumData - Premium status data from Stripe
 */
const updateUserPremiumStatus = async (userId, premiumData) => {
    try {
        const { status, customer, subscription, currentPeriodEnd, planInterval } = premiumData

        const updateData = {
            premium: {
                status: status,
                lastChecked: admin.firestore.FieldValue.serverTimestamp(),
            },
        }

        // Add Stripe customer ID if we have it
        if (customer) {
            updateData.stripeCustomerId = customer
        }

        // Add subscription details if premium
        if (status === PLAN_STATUS_PREMIUM && subscription) {
            updateData.premium.subscriptionId = subscription.id
            updateData.premium.currentPeriodEnd = currentPeriodEnd
            updateData.premium.planInterval = planInterval
        }

        await admin.firestore().doc(`users/${userId}`).update(updateData)

        functions.logger.info(`Updated premium status for user ${userId}: ${status}`)

        return { success: true, status, customer }
    } catch (error) {
        functions.logger.error(`Error updating premium status for user ${userId}:`, error)
        throw error
    }
}

/**
 * Check premium status by user ID (using stored Stripe customer ID)
 * @param {string} userId - User ID
 * @param {Object} stripe - Initialized Stripe instance
 * @returns {Promise<Object>} Premium status result
 */
const checkPremiumStatusById = async (userId, stripe) => {
    try {
        // Get user data from Firestore
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()

        if (!userDoc.exists) {
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const { stripeCustomerId, email, displayName } = userData

        let premiumData

        if (stripeCustomerId) {
            // Use stored Stripe customer ID
            premiumData = await checkPremiumStatus(stripeCustomerId, stripe)
        } else if (email) {
            // Find/create customer by email
            premiumData = await checkPremiumStatusByEmail(email, displayName, stripe)
        } else {
            throw new Error('No email or Stripe customer ID found for user')
        }

        // Update user's premium status in Firestore
        await updateUserPremiumStatus(userId, premiumData)

        return {
            success: true,
            userId,
            premiumStatus: premiumData.status,
            subscription: premiumData.subscription,
            customer: premiumData.customer,
            updated: true,
        }
    } catch (error) {
        functions.logger.error(`Error checking premium status for user ${userId}:`, error)

        // In case of error, ensure user has free status
        try {
            await admin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    premium: {
                        status: PLAN_STATUS_FREE,
                        lastChecked: admin.firestore.FieldValue.serverTimestamp(),
                        error: error.message,
                    },
                })
        } catch (updateError) {
            functions.logger.error(`Error updating user to free status:`, updateError)
        }

        return {
            success: false,
            userId,
            premiumStatus: PLAN_STATUS_FREE,
            error: error.message,
            updated: true,
        }
    }
}

/**
 * Firebase HTTP callable function to check premium status
 * Uses Firebase Secret Manager for secure access to Stripe keys
 */
const checkUserPremiumStatus = functions
    .runWith({
        secrets: [stripeSecretKey], // Declare secret dependency
        timeoutSeconds: 30,
        memory: '1GB',
    })
    .https.onCall(async (data, context) => {
        // Verify user is authenticated
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated')
        }

        const userId = context.auth.uid

        try {
            // Initialize Stripe with secret
            const stripe = initializeStripe(stripeSecretKey.value())
            const result = await checkPremiumStatusById(userId, stripe)

            return {
                success: true,
                premiumStatus: result.premiumStatus,
                subscription: result.subscription
                    ? {
                          id: result.subscription.id,
                          status: result.subscription.status,
                          currentPeriodEnd: result.subscription.current_period_end,
                          planInterval: result.subscription.items?.data[0]?.price?.recurring?.interval,
                      }
                    : null,
                customer: result.customer,
            }
        } catch (error) {
            functions.logger.error('Error in checkUserPremiumStatus:', error)
            throw new functions.https.HttpsError('internal', 'Failed to check premium status')
        }
    })

/**
 * Scheduled function to check premium status for all users (daily)
 * Uses Firebase Secret Manager for secure access to Stripe keys
 */
const dailyPremiumStatusCheck = functions
    .runWith({
        secrets: [stripeSecretKey], // Declare secret dependency
        timeoutSeconds: 540,
        memory: '2GB',
    })
    .pubsub.schedule('0 2 * * *')
    .timeZone('UTC')
    .onRun(async context => {
        try {
            functions.logger.info('Starting daily premium status check')

            // Initialize Stripe with secret
            const stripe = initializeStripe(stripeSecretKey.value())

            // Get all users with Stripe customer IDs
            const usersSnapshot = await admin.firestore().collection('users').where('stripeCustomerId', '!=', '').get()

            const promises = []
            usersSnapshot.forEach(doc => {
                promises.push(checkPremiumStatusById(doc.id, stripe))
            })

            const results = await Promise.allSettled(promises)

            let successful = 0
            let failed = 0

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    successful++
                } else {
                    failed++
                    functions.logger.error(`Failed to check premium status for user:`, result.reason)
                }
            })

            functions.logger.info(`Daily premium check completed: ${successful} successful, ${failed} failed`)

            return null
        } catch (error) {
            functions.logger.error('Error in daily premium status check:', error)
            throw error
        }
    })

module.exports = {
    checkUserPremiumStatus,
    dailyPremiumStatusCheck,
    checkPremiumStatusById,
    updateUserPremiumStatus,
}
