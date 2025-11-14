'use strict'

const { getEnvFunctions } = require('../envFunctionsHelper')

/**
 * Perform IP registry lookup to get location information
 * @param {Object} data - Function parameters
 * @param {string} data.ip - Optional IP address to lookup (uses caller's IP if not provided)
 * @returns {Promise<Object>} Location information
 */
const ipRegistryLookup = async data => {
    const { IP_REGISTRY_API_KEY } = getEnvFunctions()

    if (!IP_REGISTRY_API_KEY) {
        console.warn('IP_REGISTRY_API_KEY is not configured, using default fallback location')
        return {
            success: false,
            error: 'IP_REGISTRY_API_KEY is not configured',
            location: {
                country: { name: 'Germany' },
            },
        }
    }

    const { ip } = data
    const lookupIp = ip || '' // Empty string uses the caller's IP

    try {
        console.log('Performing IP registry lookup:', { ip: lookupIp || 'caller IP' })

        const url = lookupIp
            ? `https://api.ipregistry.co/${lookupIp}?key=${IP_REGISTRY_API_KEY}`
            : `https://api.ipregistry.co/?key=${IP_REGISTRY_API_KEY}`

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('IP Registry API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
            })
            throw new Error(`IP Registry API error: ${response.status} - ${errorText}`)
        }

        const result = await response.json()
        console.log('IP registry lookup successful:', {
            country: result.location?.country?.name,
            city: result.location?.city,
        })

        return {
            success: true,
            location: result.location,
            timeZone: result.time_zone,
            currency: result.currency,
        }
    } catch (error) {
        console.error('Failed to perform IP registry lookup:', {
            error: error.message,
            stack: error.stack,
        })

        // Return default fallback for Germany
        return {
            success: false,
            error: error.message,
            location: {
                country: { name: 'Germany' },
            },
        }
    }
}

module.exports = { ipRegistryLookup }
