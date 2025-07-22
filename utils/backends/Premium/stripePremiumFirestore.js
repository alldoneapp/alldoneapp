import { runHttpsCallableFunction, inProductionEnvironment } from '../firestore'

/**
 * Get trial tracking ID from localStorage if available
 * @returns {string|null} Tracking ID or null
 */
export const getTrialTrackingId = () => {
    try {
        const trackingId = localStorage.getItem('alldone_trial_tracking_id')
        const timestamp = localStorage.getItem('alldone_trial_timestamp')
        const planType = localStorage.getItem('alldone_trial_plan_type')

        console.log('🔍 Checking trial tracking data:', {
            trackingId: trackingId ? `${trackingId.substring(0, 20)}...` : null,
            timestamp,
            planType,
            age: timestamp ? `${Math.round((Date.now() - parseInt(timestamp)) / (1000 * 60))} minutes` : null,
        })

        // Check if tracking ID exists and is not too old (30 days)
        if (trackingId && timestamp) {
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
            if (parseInt(timestamp) > thirtyDaysAgo) {
                console.log('✅ Valid tracking ID found:', trackingId.substring(0, 20) + '...')
                return trackingId
            } else {
                console.log('⏰ Tracking ID expired, cleaning up old data')
                // Clean up old tracking data
                localStorage.removeItem('alldone_trial_tracking_id')
                localStorage.removeItem('alldone_trial_plan_type')
                localStorage.removeItem('alldone_trial_timestamp')
            }
        } else {
            console.log('❌ No valid tracking ID found in localStorage')
        }
        return null
    } catch (error) {
        console.warn('Error getting trial tracking ID:', error)
        return null
    }
}

/**
 * Clear trial tracking data from localStorage
 */
export const clearTrialTrackingId = () => {
    try {
        localStorage.removeItem('alldone_trial_tracking_id')
        localStorage.removeItem('alldone_trial_plan_type')
        localStorage.removeItem('alldone_trial_timestamp')
    } catch (error) {
        console.warn('Error clearing trial tracking data:', error)
    }
}

/**
 * Check user's premium status via Stripe with optional tracking ID
 * @param {string} trackingId - Optional tracking ID from trial signup
 * @returns {Promise<Object>} Premium status result
 */
export const checkUserPremiumStatusStripe = async (trackingId = null) => {
    try {
        // If no tracking ID provided, try to get it from localStorage
        const finalTrackingId = trackingId || getTrialTrackingId()

        console.log('🚀 Checking premium status with Stripe:', {
            providedTrackingId: trackingId ? `${trackingId.substring(0, 20)}...` : null,
            finalTrackingId: finalTrackingId ? `${finalTrackingId.substring(0, 20)}...` : null,
            hasTrackingId: !!finalTrackingId,
        })

        console.log('🔧 Calling Firebase function checkUserPremiumStatus with:', {
            trackingId: finalTrackingId ? `${finalTrackingId.substring(0, 20)}...` : null,
        })

        const result = await runHttpsCallableFunction('checkUserPremiumStatus', {
            trackingId: finalTrackingId,
        })

        console.log('🔧 Raw result from Firebase function:', result)
        console.log('📊 Premium status result:', {
            success: result.success,
            premiumStatus: result.premiumStatus,
            linkedViaTracking: result.linkedViaTracking,
            hasSubscription: !!result.subscription,
            hasCustomer: !!result.customer,
            trackingIdUsed: result.trackingId ? `${result.trackingId.substring(0, 20)}...` : null,
            resultType: typeof result,
            resultKeys: Object.keys(result || {}),
        })

        // If subscription was linked via tracking, clear the tracking data
        if (result.linkedViaTracking && finalTrackingId) {
            console.log('🔗 Subscription linked via tracking ID, clearing tracking data')
            clearTrialTrackingId()
        }

        return {
            success: true,
            premiumStatus: result.premiumStatus,
            subscription: result.subscription,
            customer: result.customer,
            linkedViaTracking: result.linkedViaTracking,
            trackingId: result.trackingId,
        }
    } catch (error) {
        console.error('❌ Error checking premium status with Stripe:', error)
        console.error('❌ Error details:', {
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack,
        })

        return {
            success: false,
            premiumStatus: 'free',
            error: error.message,
        }
    }
}

/**
 * Get Stripe payment links for premium subscription
 * Returns test links for local/staging environments and production links for production
 */
export const getStripePaymentLinks = () => {
    const isProduction = inProductionEnvironment()

    if (isProduction) {
        // Production Stripe payment links
        return {
            monthly: 'https://buy.stripe.com/7sY7sLagScKa0OyfOH9Zm0d',
            yearly: 'https://buy.stripe.com/00waEXex8h0qdBkaun9Zm0c',
        }
    } else {
        // Test Stripe payment links for local and staging environments
        return {
            monthly: 'https://buy.stripe.com/test_fZu28rex8fWm1SC7ib9Zm00',
            yearly: 'https://buy.stripe.com/test_fZu4gzcp0dOebtceKD9Zm01',
        }
    }
}

/**
 * Create Stripe customer portal session for billing management
 * @returns {Promise<Object>} Portal session result
 */
export const createStripePortalSession = async () => {
    try {
        const result = await runHttpsCallableFunction('createStripePortalSession', {})

        return {
            success: true,
            url: result.url,
        }
    } catch (error) {
        console.error('Error creating Stripe portal session:', error)

        return {
            success: false,
            error: error.message,
        }
    }
}

/**
 * Manually link Alldone account to existing Stripe subscription by email
 * @param {string} email - Email address used for Stripe subscription
 * @returns {Promise<Object>} Linking result
 */
export const linkStripeAccountByEmail = async email => {
    try {
        if (!email || !email.trim()) {
            throw new Error('Email is required for account linking')
        }

        const result = await runHttpsCallableFunction('linkStripeAccount', {
            email: email.trim().toLowerCase(),
        })

        return {
            success: result.success,
            premiumStatus: result.premiumStatus,
            subscription: result.subscription,
            customer: result.customer,
            message: result.message,
            manuallyLinked: result.manuallyLinked,
            hasInactiveSubscriptions: result.hasInactiveSubscriptions,
            totalSubscriptionsFound: result.totalSubscriptionsFound,
        }
    } catch (error) {
        console.error('Error linking Stripe account:', error)

        return {
            success: false,
            premiumStatus: 'free',
            error: error.message,
            message: error.message || 'Failed to link account',
        }
    }
}

/**
 * Debug function to check current tracking ID status (can be called from browser console)
 * Usage: window.debugTrackingId()
 */
export const debugTrackingId = () => {
    const trackingId = localStorage.getItem('alldone_trial_tracking_id')
    const timestamp = localStorage.getItem('alldone_trial_timestamp')
    const planType = localStorage.getItem('alldone_trial_plan_type')

    const debugInfo = {
        trackingId: trackingId || 'Not found',
        planType: planType || 'Not found',
        timestamp: timestamp || 'Not found',
        age: timestamp ? `${Math.round((Date.now() - parseInt(timestamp)) / (1000 * 60))} minutes` : 'N/A',
        isValid: !!(trackingId && timestamp && parseInt(timestamp) > Date.now() - 30 * 24 * 60 * 60 * 1000),
        expires: timestamp ? new Date(parseInt(timestamp) + 30 * 24 * 60 * 60 * 1000).toLocaleString() : 'N/A',
    }

    console.log('🔍 Tracking ID Debug Info:', debugInfo)
    return debugInfo
}

// Make it available globally for debugging
if (typeof window !== 'undefined') {
    window.debugTrackingId = debugTrackingId
}
