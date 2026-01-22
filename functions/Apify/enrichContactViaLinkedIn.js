const { getEnvFunctions } = require('../envFunctionsHelper')
const { deductGold } = require('../Gold/goldHelper')

const ENRICHMENT_GOLD_COST = 30

const enrichContactViaLinkedIn = async (data, userId) => {
    const { APIFY_API_KEY } = getEnvFunctions()
    const { linkedInUrl } = data

    if (!APIFY_API_KEY) {
        throw new Error('APIFY_API_KEY is not configured')
    }

    if (!linkedInUrl) {
        throw new Error('LinkedIn URL is required')
    }

    const goldResult = await deductGold(userId, ENRICHMENT_GOLD_COST)
    if (!goldResult.success) {
        return { success: false, error: 'insufficient_gold', message: goldResult.message }
    }

    const response = await fetch(
        `https://api.apify.com/v2/acts/dev_fusion~linkedin-profile-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileUrls: [linkedInUrl] }),
        }
    )

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Apify API error: ${response.status} - ${errorText}`)
    }

    const results = await response.json()

    if (!results || results.length === 0) {
        throw new Error('No profile data returned from LinkedIn')
    }

    const profile = results[0]

    if (profile.succeeded === false) {
        throw new Error(profile.error || 'Failed to scrape LinkedIn profile')
    }

    return {
        success: true,
        data: {
            displayName: profile.fullName || '',
            company: profile.companyName || '',
            role: profile.jobTitle || profile.headline || '',
            email: profile.email || '',
            phone: profile.mobileNumber || '',
            description: profile.summary || '',
        },
    }
}

module.exports = { enrichContactViaLinkedIn, ENRICHMENT_GOLD_COST }
