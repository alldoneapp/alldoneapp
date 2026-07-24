const { getEnvFunctions } = require('../envFunctionsHelper')
const functions = require('firebase-functions')

let stripe
try {
    const env = getEnvFunctions()
    stripe = require('stripe')(env.STRIPE_SECRET_KEY)
} catch (error) {
    functions.logger.error('Failed to initialize Stripe:', error)
    // Fallback for development/testing
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_...')
}

const PLAN_STATUS_FREE = 'free'
const PLAN_STATUS_PREMIUM = 'premium'

/**
 * Get or create Stripe customer by email
 * @param {string} email - User email
 * @param {string} name - User display name
 * @returns {Promise<Object>} Stripe customer object
 */
const getOrCreateCustomer = async (email, name) => {
    functions.logger.info('getOrCreateCustomer called', { email, name })

    try {
        // First, try to find existing customer by email
        functions.logger.info('Searching for existing customer in Stripe', { email })
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1,
        })

        functions.logger.info('Existing customer search result', {
            email,
            foundCount: existingCustomers.data.length,
            foundCustomers: existingCustomers.data.map(c => ({ id: c.id, email: c.email })),
        })

        if (existingCustomers.data.length > 0) {
            functions.logger.info('Found existing customer', {
                email,
                customerId: existingCustomers.data[0].id,
            })
            return existingCustomers.data[0]
        }

        // If no customer found, create a new one
        functions.logger.info('Creating new customer in Stripe', { email, name })
        const customer = await stripe.customers.create({
            email: email,
            name: name,
        })

        functions.logger.info('New customer created', {
            email,
            customerId: customer.id,
            customerEmail: customer.email,
        })

        return customer
    } catch (error) {
        functions.logger.error('Error getting/creating Stripe customer:', {
            email,
            name,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        throw error
    }
}

/**
 * Check if user has active premium subscription
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<Object>} Premium status object
 */
const checkPremiumStatus = async customerId => {
    functions.logger.info('checkPremiumStatus called', { customerId })

    try {
        if (!customerId) {
            functions.logger.info('No customer ID provided, returning free status')
            return {
                status: PLAN_STATUS_FREE,
                subscription: null,
                customer: null,
            }
        }

        // Get all subscriptions for the customer (active and trialing)
        functions.logger.info('Fetching active and trialing subscriptions from Stripe', { customerId })
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 100,
        })

        functions.logger.info('Subscriptions retrieved', {
            customerId,
            subscriptionCount: subscriptions.data.length,
            subscriptions: subscriptions.data.map(sub => ({
                id: sub.id,
                status: sub.status,
                currentPeriodEnd: sub.current_period_end,
                currentTime: Math.floor(Date.now() / 1000),
            })),
        })

        const activeSubscription = subscriptions.data.find(
            sub =>
                (sub.status === 'active' || sub.status === 'trialing') &&
                sub.current_period_end > Math.floor(Date.now() / 1000)
        )

        if (activeSubscription) {
            functions.logger.info('Premium subscription found', {
                customerId,
                subscriptionId: activeSubscription.id,
                status: activeSubscription.status,
                currentPeriodEnd: activeSubscription.current_period_end,
                planInterval: activeSubscription.items.data[0]?.price?.recurring?.interval,
            })

            return {
                status: PLAN_STATUS_PREMIUM,
                subscription: activeSubscription,
                customer: customerId,
                currentPeriodEnd: activeSubscription.current_period_end,
                planInterval: activeSubscription.items.data[0]?.price?.recurring?.interval,
            }
        }

        functions.logger.info('No premium subscription found, returning free status', { customerId })
        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: customerId,
        }
    } catch (error) {
        functions.logger.error('Error checking premium status:', {
            customerId,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        // Return free status on error to be safe
        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: customerId,
            error: error.message,
        }
    }
}

/**
 * Check premium status by email (for users without stored customer ID)
 * @param {string} email - User email
 * @param {string} name - User display name
 * @returns {Promise<Object>} Premium status object with customer info
 */
const checkPremiumStatusByEmail = async (email, name) => {
    functions.logger.info('checkPremiumStatusByEmail called', { email, name })

    try {
        functions.logger.info('Getting or creating Stripe customer', { email, name })
        const customer = await getOrCreateCustomer(email, name)

        functions.logger.info('Customer retrieved/created', {
            customerId: customer.id,
            customerEmail: customer.email,
            hasCustomer: !!customer,
        })

        functions.logger.info('Checking premium status for customer', { customerId: customer.id })
        const premiumStatus = await checkPremiumStatus(customer.id)

        functions.logger.info('Premium status result', {
            email,
            customerId: customer.id,
            status: premiumStatus.status,
            hasSubscription: !!premiumStatus.subscription,
            subscriptionId: premiumStatus.subscription?.id,
            subscriptionStatus: premiumStatus.subscription?.status,
        })

        return {
            ...premiumStatus,
            customer: customer.id,
            customerObject: customer,
        }
    } catch (error) {
        functions.logger.error('Error checking premium status by email:', {
            email,
            name,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: null,
            error: error.message,
        }
    }
}

/**
 * Get customer information from Stripe
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<Object|null>} Customer object or null
 */
const getCustomer = async customerId => {
    try {
        if (!customerId) return null

        const customer = await stripe.customers.retrieve(customerId)
        return customer.deleted ? null : customer
    } catch (error) {
        functions.logger.error('Error getting Stripe customer:', error)
        return null
    }
}

/**
 * Find Stripe subscription by client_reference_id (tracking ID)
 * @param {string} trackingId - The tracking ID passed to Stripe
 * @returns {Promise<Object|null>} Subscription object with customer info or null
 */
const findSubscriptionByTrackingId = async trackingId => {
    functions.logger.info('findSubscriptionByTrackingId called', { trackingId })

    try {
        if (!trackingId) {
            functions.logger.info('No tracking ID provided')
            return null
        }

        // Search for subscriptions with the tracking ID in metadata
        // Note: Stripe payment links store client_reference_id in the session metadata
        const sessions = await stripe.checkout.sessions.list({
            limit: 100,
        })

        functions.logger.info('Searched sessions', {
            trackingId,
            sessionCount: sessions.data.length,
        })

        // Find session with matching client_reference_id
        const matchingSession = sessions.data.find(
            session => session.client_reference_id === trackingId && session.payment_status === 'paid'
        )

        if (!matchingSession) {
            functions.logger.info('No matching paid session found', { trackingId })
            return null
        }

        functions.logger.info('Found matching session', {
            trackingId,
            sessionId: matchingSession.id,
            customerId: matchingSession.customer,
        })

        // Get the customer from the session
        const customerId = matchingSession.customer
        if (!customerId) {
            functions.logger.warn('Session has no customer ID', { trackingId, sessionId: matchingSession.id })
            return null
        }

        // Get customer details
        const customer = await stripe.customers.retrieve(customerId)

        // Get subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 10,
        })

        const activeSubscription = subscriptions.data.find(
            sub =>
                (sub.status === 'active' || sub.status === 'trialing') &&
                sub.current_period_end > Math.floor(Date.now() / 1000)
        )

        if (activeSubscription) {
            functions.logger.info('Found active subscription for tracking ID', {
                trackingId,
                customerId,
                subscriptionId: activeSubscription.id,
                customerEmail: customer.email,
            })

            return {
                customer: customer,
                subscription: activeSubscription,
                customerId: customerId,
                trackingId: trackingId,
            }
        } else {
            functions.logger.info('No active subscription found for customer', {
                trackingId,
                customerId,
                subscriptionCount: subscriptions.data.length,
            })
            return null
        }
    } catch (error) {
        functions.logger.error('Error finding subscription by tracking ID:', {
            trackingId,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        return null
    }
}

/**
 * Check premium status by tracking ID and email fallback
 * @param {string} trackingId - The tracking ID from trial signup
 * @param {string} email - User email
 * @param {string} name - User display name
 * @returns {Promise<Object>} Premium status object with customer info
 */
const checkPremiumStatusByTrackingIdAndEmail = async (trackingId, email, name) => {
    functions.logger.info('checkPremiumStatusByTrackingIdAndEmail called', { trackingId, email, name })

    try {
        // First try to find subscription by tracking ID
        if (trackingId) {
            const trackingResult = await findSubscriptionByTrackingId(trackingId)
            if (trackingResult) {
                functions.logger.info('Found subscription via tracking ID', {
                    trackingId,
                    customerId: trackingResult.customerId,
                    customerEmail: trackingResult.customer.email,
                    userEmail: email,
                })

                // Check if subscription is active
                const premiumStatus = await checkPremiumStatus(trackingResult.customerId)

                return {
                    ...premiumStatus,
                    customer: trackingResult.customerId,
                    customerObject: trackingResult.customer,
                    linkedViaTracking: true,
                    trackingId: trackingId,
                }
            }
        }

        // Fallback to email-based lookup
        functions.logger.info('Tracking ID lookup failed, falling back to email', { trackingId, email })
        return await checkPremiumStatusByEmail(email, name)
    } catch (error) {
        functions.logger.error('Error checking premium status by tracking ID and email:', {
            trackingId,
            email,
            name,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: null,
            error: error.message,
        }
    }
}

/**
 * Get all subscriptions for a customer
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<Array>} Array of subscriptions
 */
const getCustomerSubscriptions = async customerId => {
    try {
        if (!customerId) return []

        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 100,
        })

        return subscriptions.data
    } catch (error) {
        functions.logger.error('Error getting customer subscriptions:', error)
        return []
    }
}

/**
 * Manual account linking by email - searches more thoroughly for subscriptions
 * @param {string} email - Email to search for in Stripe
 * @param {string} userName - User's display name
 * @returns {Promise<Object>} Premium status object with detailed search results
 */
const linkAccountByEmail = async (email, userName) => {
    functions.logger.info('linkAccountByEmail called', { email, userName })

    try {
        if (!email) {
            throw new Error('Email is required for manual linking')
        }

        // Step 1: Find customers by email
        functions.logger.info('Searching for customers by email', { email })
        const customers = await stripe.customers.list({
            email: email,
            limit: 10,
        })

        functions.logger.info('Found customers', {
            email,
            customerCount: customers.data.length,
            customers: customers.data.map(c => ({ id: c.id, email: c.email })),
        })

        if (customers.data.length === 0) {
            functions.logger.info('No customers found for email', { email })
            return {
                status: PLAN_STATUS_FREE,
                subscription: null,
                customer: null,
                message: 'No Stripe customer found with this email address',
            }
        }

        // Step 2: Check all customers for active subscriptions
        let bestResult = null
        let allSubscriptions = []

        for (const customer of customers.data) {
            functions.logger.info('Checking subscriptions for customer', {
                customerId: customer.id,
                customerEmail: customer.email,
            })

            const subscriptions = await stripe.subscriptions.list({
                customer: customer.id,
                limit: 10,
            })

            allSubscriptions = allSubscriptions.concat(subscriptions.data)

            functions.logger.info('Found subscriptions for customer', {
                customerId: customer.id,
                subscriptionCount: subscriptions.data.length,
                subscriptions: subscriptions.data.map(sub => ({
                    id: sub.id,
                    status: sub.status,
                    currentPeriodEnd: sub.current_period_end,
                    currentTime: Math.floor(Date.now() / 1000),
                })),
            })

            // Look for active or trialing subscriptions
            const activeSubscription = subscriptions.data.find(
                sub =>
                    (sub.status === 'active' || sub.status === 'trialing') &&
                    sub.current_period_end > Math.floor(Date.now() / 1000)
            )

            if (activeSubscription && !bestResult) {
                bestResult = {
                    customer: customer,
                    subscription: activeSubscription,
                    customerId: customer.id,
                }
                functions.logger.info('Found active subscription', {
                    email,
                    customerId: customer.id,
                    subscriptionId: activeSubscription.id,
                    status: activeSubscription.status,
                })
            }
        }

        // Step 3: Return results
        if (bestResult) {
            return {
                status: PLAN_STATUS_PREMIUM,
                subscription: bestResult.subscription,
                customer: bestResult.customerId,
                customerObject: bestResult.customer,
                currentPeriodEnd: bestResult.subscription.current_period_end,
                planInterval: bestResult.subscription.items?.data[0]?.price?.recurring?.interval,
                message: 'Active subscription found and linked successfully',
                manuallyLinked: true,
            }
        } else {
            const hasAnySubscriptions = allSubscriptions.length > 0
            const inactiveSubscriptions = allSubscriptions.filter(
                sub => sub.status === 'canceled' || sub.status === 'incomplete_expired'
            )

            let message = 'No active subscriptions found for this email'
            if (hasAnySubscriptions) {
                message += `. Found ${allSubscriptions.length} total subscription(s), but none are currently active.`
                if (inactiveSubscriptions.length > 0) {
                    message += ` ${inactiveSubscriptions.length} subscription(s) are canceled or expired.`
                }
            }

            functions.logger.info('No active subscriptions found', {
                email,
                totalSubscriptions: allSubscriptions.length,
                inactiveCount: inactiveSubscriptions.length,
                message,
            })

            return {
                status: PLAN_STATUS_FREE,
                subscription: null,
                customer: customers.data[0]?.id || null,
                customerObject: customers.data[0] || null,
                message: message,
                hasInactiveSubscriptions: inactiveSubscriptions.length > 0,
                totalSubscriptionsFound: allSubscriptions.length,
            }
        }
    } catch (error) {
        functions.logger.error('Error in manual account linking:', {
            email,
            userName,
            error: error.message,
            code: error.code,
            stack: error.stack,
        })

        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: null,
            error: error.message,
            message: 'Error occurred while searching for subscription',
        }
    }
}

module.exports = {
    getOrCreateCustomer,
    checkPremiumStatus,
    checkPremiumStatusByEmail,
    getCustomer,
    getCustomerSubscriptions,
    findSubscriptionByTrackingId,
    checkPremiumStatusByTrackingIdAndEmail,
    PLAN_STATUS_FREE,
    PLAN_STATUS_PREMIUM,
    linkAccountByEmail,
}
