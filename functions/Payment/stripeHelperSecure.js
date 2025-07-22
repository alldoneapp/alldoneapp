const functions = require('firebase-functions')
const { defineSecret } = require('firebase-functions/params')

// Define secrets
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')

let stripe

/**
 * Initialize Stripe with secret
 * This function should be called with secrets access
 */
const initializeStripe = secretKey => {
    if (!stripe) {
        stripe = require('stripe')(secretKey)
    }
    return stripe
}

const PLAN_STATUS_FREE = 'free'
const PLAN_STATUS_PREMIUM = 'premium'

/**
 * Get or create Stripe customer by email
 * @param {string} email - User email
 * @param {string} name - User display name
 * @param {Object} stripe - Initialized Stripe instance
 * @returns {Promise<Object>} Stripe customer object
 */
const getOrCreateCustomer = async (email, name, stripe) => {
    try {
        // First, try to find existing customer by email
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1,
        })

        if (existingCustomers.data.length > 0) {
            return existingCustomers.data[0]
        }

        // If no customer found, create a new one
        const customer = await stripe.customers.create({
            email: email,
            name: name,
        })

        return customer
    } catch (error) {
        functions.logger.error('Error getting/creating Stripe customer:', error)
        throw error
    }
}

/**
 * Check if user has active premium subscription
 * @param {string} customerId - Stripe customer ID
 * @param {Object} stripe - Initialized Stripe instance
 * @returns {Promise<Object>} Premium status object
 */
const checkPremiumStatus = async (customerId, stripe) => {
    try {
        if (!customerId) {
            return {
                status: PLAN_STATUS_FREE,
                subscription: null,
                customer: null,
            }
        }

        // Get all active subscriptions for the customer
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 100,
        })

        const activeSubscription = subscriptions.data.find(
            sub => sub.status === 'active' && sub.current_period_end > Math.floor(Date.now() / 1000)
        )

        if (activeSubscription) {
            return {
                status: PLAN_STATUS_PREMIUM,
                subscription: activeSubscription,
                customer: customerId,
                currentPeriodEnd: activeSubscription.current_period_end,
                planInterval: activeSubscription.items.data[0]?.price?.recurring?.interval,
            }
        }

        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: customerId,
        }
    } catch (error) {
        functions.logger.error('Error checking premium status:', error)
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
 * @param {Object} stripe - Initialized Stripe instance
 * @returns {Promise<Object>} Premium status object with customer info
 */
const checkPremiumStatusByEmail = async (email, name, stripe) => {
    try {
        const customer = await getOrCreateCustomer(email, name, stripe)
        const premiumStatus = await checkPremiumStatus(customer.id, stripe)

        return {
            ...premiumStatus,
            customer: customer.id,
            customerObject: customer,
        }
    } catch (error) {
        functions.logger.error('Error checking premium status by email:', error)
        return {
            status: PLAN_STATUS_FREE,
            subscription: null,
            customer: null,
            error: error.message,
        }
    }
}

module.exports = {
    stripeSecretKey, // Export the secret definition
    initializeStripe,
    PLAN_STATUS_FREE,
    PLAN_STATUS_PREMIUM,
    getOrCreateCustomer,
    checkPremiumStatus,
    checkPremiumStatusByEmail,
}
