const functions = require('firebase-functions')
const admin = require('firebase-admin')
const {
    checkPremiumStatusByEmail,
    checkPremiumStatus,
    checkPremiumStatusByTrackingIdAndEmail,
    linkAccountByEmail,
    PLAN_STATUS_FREE,
    PLAN_STATUS_PREMIUM,
} = require('../Payment/stripeHelper')

/**
 * Updates user's premium status in Firestore based on Stripe subscription
 * @param {string} userId - User ID
 * @param {Object} premiumData - Premium status data from Stripe
 */
const updateUserPremiumStatus = async (userId, premiumData) => {
    functions.logger.info('updateUserPremiumStatus called', {
        userId,
        premiumDataStatus: premiumData.status,
        hasPremiumData: !!premiumData,
        hasSubscription: !!premiumData.subscription,
        hasCustomer: !!premiumData.customer,
    })

    try {
        const { status, customer, subscription, currentPeriodEnd, planInterval } = premiumData

        functions.logger.info('Extracted premium data fields', {
            userId,
            status,
            hasCustomer: !!customer,
            hasSubscription: !!subscription,
            currentPeriodEnd,
            planInterval,
        })

        const updateData = {
            premium: {
                status: status,
                lastChecked: admin.firestore.FieldValue.serverTimestamp(),
            },
        }

        // Add Stripe customer ID if we have it
        if (customer) {
            updateData.stripeCustomerId = customer
            functions.logger.info('Added Stripe customer ID to update data', { userId, customer })
        }

        // Add subscription details if premium
        if (status === PLAN_STATUS_PREMIUM && subscription) {
            updateData.premium.subscriptionId = subscription.id
            updateData.premium.currentPeriodEnd = currentPeriodEnd
            updateData.premium.planInterval = planInterval
            functions.logger.info('Added subscription details to update data', {
                userId,
                subscriptionId: subscription.id,
                currentPeriodEnd,
                planInterval,
            })
        }

        functions.logger.info('Updating Firestore document with premium data', {
            userId,
            updateData: {
                premiumStatus: updateData.premium.status,
                hasSubscriptionId: !!updateData.premium.subscriptionId,
                stripeCustomerId: updateData.stripeCustomerId,
            },
        })

        await admin.firestore().doc(`users/${userId}`).update(updateData)

        functions.logger.info(`Updated premium status for user ${userId}: ${status}`)

        return { success: true, status, customer }
    } catch (error) {
        functions.logger.error(`Error updating premium status for user ${userId}:`, {
            userId,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        throw error
    }
}

/**
 * Check premium status by user ID (using stored Stripe customer ID or tracking ID)
 * @param {string} userId - User ID
 * @param {string} trackingId - Optional tracking ID from trial signup
 * @returns {Promise<Object>} Premium status result
 */
const checkPremiumStatusById = async (userId, trackingId = null) => {
    functions.logger.info('checkPremiumStatusById called', { userId, trackingId })

    try {
        // Get user data from Firestore
        functions.logger.info('Fetching user document from Firestore', { userId })
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()

        if (!userDoc.exists) {
            functions.logger.error('User document not found', { userId })
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const { stripeCustomerId, email, displayName } = userData

        functions.logger.info('User data retrieved from Firestore', {
            userId,
            hasStripeCustomerId: !!stripeCustomerId,
            stripeCustomerId,
            hasEmail: !!email,
            email,
            hasDisplayName: !!displayName,
            currentPremiumStatus: userData.premium?.status,
            trackingId,
        })

        let premiumData

        if (stripeCustomerId) {
            // Use stored Stripe customer ID
            functions.logger.info('Using stored Stripe customer ID', { userId, stripeCustomerId })
            premiumData = await checkPremiumStatus(stripeCustomerId)
        } else if (trackingId || email) {
            // Try tracking ID first, then fall back to email
            functions.logger.info('Using tracking ID and email fallback', { userId, trackingId, email })
            premiumData = await checkPremiumStatusByTrackingIdAndEmail(trackingId, email, displayName)
        } else {
            functions.logger.error('No email, tracking ID, or Stripe customer ID found', {
                userId,
                userData: Object.keys(userData),
            })
            throw new Error('No email, tracking ID, or Stripe customer ID found for user')
        }

        functions.logger.info('Premium data retrieved from Stripe', {
            userId,
            status: premiumData.status,
            hasSubscription: !!premiumData.subscription,
            hasCustomer: !!premiumData.customer,
            subscriptionStatus: premiumData.subscription?.status,
            customerId: premiumData.customer?.id || premiumData.customer,
            linkedViaTracking: premiumData.linkedViaTracking,
            trackingId: premiumData.trackingId,
        })

        // Update user's premium status in Firestore
        functions.logger.info('Updating user premium status in Firestore', { userId, newStatus: premiumData.status })
        await updateUserPremiumStatus(userId, premiumData)

        const result = {
            success: true,
            userId,
            premiumStatus: premiumData.status,
            subscription: premiumData.subscription,
            customer: premiumData.customer,
            linkedViaTracking: premiumData.linkedViaTracking,
            trackingId: premiumData.trackingId,
            updated: true,
        }

        functions.logger.info('checkPremiumStatusById completed successfully', {
            userId,
            success: result.success,
            premiumStatus: result.premiumStatus,
            linkedViaTracking: result.linkedViaTracking,
        })

        return result
    } catch (error) {
        functions.logger.error(`Error checking premium status for user ${userId}:`, {
            userId,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })

        // In case of error, ensure user has free status
        try {
            functions.logger.info('Setting user to free status due to error', { userId })
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
 * Updated to work with v2 functions wrapper and tracking ID support
 */
const checkUserPremiumStatus = async (data, context) => {
    functions.logger.info('checkUserPremiumStatus called', {
        hasData: !!data,
        hasAuth: !!context?.auth,
        authUid: context?.auth?.uid,
        trackingId: data?.trackingId,
    })

    // Verify user is authenticated
    if (!context.auth) {
        functions.logger.error('User not authenticated in checkUserPremiumStatus')
        const error = new Error('User must be authenticated')
        error.code = 'unauthenticated'
        throw error
    }

    const userId = context.auth.uid
    const trackingId = data?.trackingId || null
    functions.logger.info('Processing premium status check', { userId, trackingId })

    try {
        functions.logger.info('Calling checkPremiumStatusById', { userId, trackingId })
        const result = await checkPremiumStatusById(userId, trackingId)

        functions.logger.info('checkPremiumStatusById result', {
            userId,
            success: result.success,
            premiumStatus: result.premiumStatus,
            hasSubscription: !!result.subscription,
            hasCustomer: !!result.customer,
            subscriptionId: result.subscription?.id,
            subscriptionStatus: result.subscription?.status,
            linkedViaTracking: result.linkedViaTracking,
            trackingId: result.trackingId,
        })

        const response = {
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
            linkedViaTracking: result.linkedViaTracking,
            trackingId: result.trackingId,
        }

        functions.logger.info('checkUserPremiumStatus response', {
            userId,
            success: response.success,
            premiumStatus: response.premiumStatus,
            hasSubscription: !!response.subscription,
        })

        return response
    } catch (error) {
        functions.logger.error('Error in checkUserPremiumStatus:', {
            userId,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        const functionError = new Error('Failed to check premium status')
        functionError.code = 'internal'
        throw functionError
    }
}

/**
 * Firebase HTTP function for webhook handling (for future use)
 */
const handleStripeWebhook = functions.https.onRequest(async (req, res) => {
    // This will be implemented later for real-time subscription updates
    res.status(200).send('Webhook received')
})

/**
 * Create Stripe customer portal session
 * Updated to work with v2 functions wrapper
 */
const createStripePortalSession = async (data, context) => {
    try {
        // Check if user is authenticated
        if (!context.auth) {
            const error = new Error('User must be authenticated')
            error.code = 'unauthenticated'
            throw error
        }

        const userId = context.auth.uid

        // Get user document to find Stripe customer ID
        const userDoc = await admin.firestore().collection('users').doc(userId).get()

        if (!userDoc.exists) {
            const error = new Error('User not found')
            error.code = 'not-found'
            throw error
        }

        const userData = userDoc.data()
        const stripeCustomerId = userData.stripeCustomerId

        if (!stripeCustomerId) {
            const error = new Error('No Stripe customer ID found for user')
            error.code = 'failed-precondition'
            throw error
        }

        // Get Stripe instance from helper
        const { getEnvFunctions } = require('../envFunctionsHelper')
        const env = getEnvFunctions()
        const stripe = require('stripe')(env.STRIPE_SECRET_KEY)

        // Create portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `${process.env.DOMAIN || 'https://my.alldone.app'}/settings/premium`,
        })

        functions.logger.info('Created Stripe portal session', {
            userId,
            customerId: stripeCustomerId,
            sessionId: session.id,
        })

        return {
            url: session.url,
        }
    } catch (error) {
        functions.logger.error('Error creating Stripe portal session:', error)

        if (error.code) {
            throw error
        }

        const functionError = new Error('Failed to create portal session')
        functionError.code = 'internal'
        throw functionError
    }
}

/**
 * Scheduled function to check premium status for all users (daily)
 */
const dailyPremiumStatusCheck = functions.pubsub.schedule('0 2 * * *').onRun(async context => {
    try {
        functions.logger.info('Starting daily premium status check')

        // Get all users with Stripe customer IDs
        const usersSnapshot = await admin.firestore().collection('users').where('stripeCustomerId', '!=', '').get()

        const promises = []
        usersSnapshot.forEach(doc => {
            promises.push(checkPremiumStatusById(doc.id))
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

/**
 * Firebase HTTP callable function for manual account linking
 * Allows users to link their Alldone account to an existing Stripe subscription
 */
const linkStripeAccount = async (data, context) => {
    functions.logger.info('linkStripeAccount called', {
        hasData: !!data,
        hasAuth: !!context?.auth,
        authUid: context?.auth?.uid,
        linkingEmail: data?.email ? 'provided' : 'missing',
    })

    // Verify user is authenticated
    if (!context.auth) {
        functions.logger.error('User not authenticated in linkStripeAccount')
        const error = new Error('User must be authenticated')
        error.code = 'unauthenticated'
        throw error
    }

    const userId = context.auth.uid
    const linkingEmail = data?.email

    if (!linkingEmail) {
        const error = new Error('Email is required for manual linking')
        error.code = 'invalid-argument'
        throw error
    }

    functions.logger.info('Processing manual account linking', { userId, linkingEmail })

    try {
        // Get user data for display name
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()
        if (!userDoc.exists) {
            const error = new Error('User not found')
            error.code = 'not-found'
            throw error
        }

        const userData = userDoc.data()
        const displayName = userData.displayName || 'User'

        functions.logger.info('Calling linkAccountByEmail', { userId, linkingEmail, displayName })
        const linkingResult = await linkAccountByEmail(linkingEmail, displayName)

        functions.logger.info('linkAccountByEmail result', {
            userId,
            linkingEmail,
            status: linkingResult.status,
            hasSubscription: !!linkingResult.subscription,
            hasCustomer: !!linkingResult.customer,
            message: linkingResult.message,
            manuallyLinked: linkingResult.manuallyLinked,
        })

        // If successful, update user's premium status
        if (linkingResult.status === PLAN_STATUS_PREMIUM) {
            functions.logger.info('Updating user premium status after successful linking', { userId })
            await updateUserPremiumStatus(userId, linkingResult)
        }

        const response = {
            success: linkingResult.status === PLAN_STATUS_PREMIUM,
            premiumStatus: linkingResult.status,
            subscription: linkingResult.subscription
                ? {
                      id: linkingResult.subscription.id,
                      status: linkingResult.subscription.status,
                      currentPeriodEnd: linkingResult.subscription.current_period_end,
                      planInterval: linkingResult.subscription.items?.data[0]?.price?.recurring?.interval,
                  }
                : null,
            customer: linkingResult.customer,
            message: linkingResult.message,
            manuallyLinked: linkingResult.manuallyLinked || false,
            hasInactiveSubscriptions: linkingResult.hasInactiveSubscriptions || false,
            totalSubscriptionsFound: linkingResult.totalSubscriptionsFound || 0,
        }

        functions.logger.info('linkStripeAccount completed', {
            userId,
            success: response.success,
            message: response.message,
        })

        return response
    } catch (error) {
        functions.logger.error('Error in linkStripeAccount:', {
            userId,
            linkingEmail,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })

        const errorCode = error.code || 'internal'
        const errorMessage = error.message || 'Failed to link account'
        const httpsError = new Error(errorMessage)
        httpsError.code = errorCode
        throw httpsError
    }
}

module.exports = {
    checkUserPremiumStatus,
    handleStripeWebhook,
    dailyPremiumStatusCheck,
    checkPremiumStatusById,
    updateUserPremiumStatus,
    createStripePortalSession,
    linkStripeAccount,
}
