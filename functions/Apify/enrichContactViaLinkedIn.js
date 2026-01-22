const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { deductGold } = require('../Gold/goldHelper')

const ENRICHMENT_GOLD_COST = 30

async function uploadLinkedInPhoto(photoUrl, projectId, contactId) {
    console.log('[LinkedIn Enrichment] Downloading photo from:', photoUrl)
    const photoResponse = await fetch(photoUrl)
    if (!photoResponse.ok) {
        console.warn('[LinkedIn Enrichment] Failed to download photo:', photoResponse.status)
        return null
    }

    const contentType = photoResponse.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await photoResponse.arrayBuffer())
    console.log('[LinkedIn Enrichment] Photo downloaded, size:', buffer.length, 'bytes')

    const bucket = admin.storage().bucket()
    const timestamp = Date.now()
    const filePath = `projectsContacts/${projectId}/${contactId}/${contactId}@${timestamp}`

    const file = bucket.file(filePath)
    await file.save(buffer, {
        metadata: { contentType },
    })
    await file.makePublic()

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`
    console.log('[LinkedIn Enrichment] Photo uploaded to:', publicUrl)
    return publicUrl
}

const enrichContactViaLinkedIn = async (data, userId) => {
    console.log('[LinkedIn Enrichment] Starting enrichment for user:', userId)
    console.log('[LinkedIn Enrichment] Input data:', JSON.stringify(data))

    const { APIFY_API_KEY } = getEnvFunctions()
    const { linkedInUrl, projectId, contactId } = data

    if (!APIFY_API_KEY) {
        console.error('[LinkedIn Enrichment] APIFY_API_KEY is not configured')
        throw new Error('APIFY_API_KEY is not configured')
    }

    if (!linkedInUrl) {
        console.error('[LinkedIn Enrichment] No LinkedIn URL provided')
        throw new Error('LinkedIn URL is required')
    }

    console.log('[LinkedIn Enrichment] Deducting', ENRICHMENT_GOLD_COST, 'gold from user:', userId)
    const goldResult = await deductGold(userId, ENRICHMENT_GOLD_COST)
    console.log('[LinkedIn Enrichment] Gold deduction result:', JSON.stringify(goldResult))

    if (!goldResult.success) {
        console.warn('[LinkedIn Enrichment] Insufficient gold for user:', userId)
        return { success: false, error: 'insufficient_gold', message: goldResult.message }
    }

    console.log('[LinkedIn Enrichment] Calling Apify API for URL:', linkedInUrl)
    const response = await fetch(
        `https://api.apify.com/v2/acts/dev_fusion~linkedin-profile-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileUrls: [linkedInUrl] }),
        }
    )

    console.log('[LinkedIn Enrichment] Apify response status:', response.status)

    if (!response.ok) {
        const errorText = await response.text()
        console.error('[LinkedIn Enrichment] Apify API error:', response.status, errorText)
        throw new Error(`Apify API error: ${response.status} - ${errorText}`)
    }

    const results = await response.json()
    console.log('[LinkedIn Enrichment] Apify returned', results?.length || 0, 'results')

    if (!results || results.length === 0) {
        console.error('[LinkedIn Enrichment] No profile data returned')
        throw new Error('No profile data returned from LinkedIn')
    }

    const profile = results[0]
    console.log('[LinkedIn Enrichment] Raw profile keys:', Object.keys(profile))
    console.log('[LinkedIn Enrichment] Raw profile data:', JSON.stringify(profile).substring(0, 2000))
    console.log('[LinkedIn Enrichment] Profile succeeded:', profile.succeeded !== false)

    if (profile.succeeded === false) {
        console.error('[LinkedIn Enrichment] Scraping failed:', profile.error)
        throw new Error(profile.error || 'Failed to scrape LinkedIn profile')
    }

    const enrichedData = {
        displayName: profile.fullName || '',
        company: profile.companyName || '',
        role: profile.jobTitle || profile.headline || '',
        email: profile.email || '',
        phone: profile.mobileNumber || '',
        description: profile.about || '',
    }

    // Upload LinkedIn photo to Firebase Storage if available
    const linkedInPhotoUrl = profile.profilePicHighQuality || profile.profilePic || ''
    if (linkedInPhotoUrl && projectId && contactId) {
        try {
            const storageUrl = await uploadLinkedInPhoto(linkedInPhotoUrl, projectId, contactId)
            if (storageUrl) {
                enrichedData.photoURL = storageUrl
            }
        } catch (photoError) {
            console.warn('[LinkedIn Enrichment] Photo upload failed:', photoError.message)
        }
    }

    console.log('[LinkedIn Enrichment] Enriched data:', JSON.stringify(enrichedData))
    console.log('[LinkedIn Enrichment] Enrichment completed successfully')

    return {
        success: true,
        data: enrichedData,
    }
}

const SEARCH_GOLD_COST = 20

const searchLinkedInProfile = async (data, userId) => {
    console.log('[LinkedIn Search] Starting search for user:', userId)
    console.log('[LinkedIn Search] Input data:', JSON.stringify(data))

    const { TAVILY_API_KEY } = getEnvFunctions()
    const { displayName, company, role, email } = data

    if (!TAVILY_API_KEY || TAVILY_API_KEY === '' || TAVILY_API_KEY.startsWith('your_')) {
        console.error('[LinkedIn Search] TAVILY_API_KEY is not configured')
        throw new Error('TAVILY_API_KEY is not configured')
    }

    if (!displayName && !email) {
        console.error('[LinkedIn Search] No contact info provided')
        throw new Error('At least a name or email is required to search')
    }

    console.log('[LinkedIn Search] Deducting', SEARCH_GOLD_COST, 'gold from user:', userId)
    const goldResult = await deductGold(userId, SEARCH_GOLD_COST)
    console.log('[LinkedIn Search] Gold deduction result:', JSON.stringify(goldResult))

    if (!goldResult.success) {
        console.warn('[LinkedIn Search] Insufficient gold for user:', userId)
        return { success: false, error: 'insufficient_gold', message: goldResult.message }
    }

    // Build search query from contact info
    const queryParts = []
    if (displayName) queryParts.push(displayName)
    if (company) queryParts.push(company)
    if (role) queryParts.push(role)
    const query = `${queryParts.join(' ')} LinkedIn profile site:linkedin.com/in/`

    console.log('[LinkedIn Search] Search query:', query)

    try {
        const { tavily } = require('@tavily/core')
        const tvly = tavily({ apiKey: TAVILY_API_KEY })

        const response = await tvly.search(query, {
            searchDepth: 'basic',
            maxResults: 5,
            includeDomains: ['linkedin.com'],
        })

        console.log('[LinkedIn Search] Tavily returned', response.results?.length || 0, 'results')

        // Find the first linkedin.com/in/ URL
        const linkedInResult = response.results?.find(r => r.url && r.url.includes('linkedin.com/in/'))

        if (linkedInResult) {
            console.log('[LinkedIn Search] Found LinkedIn URL:', linkedInResult.url)
            return {
                success: true,
                linkedInUrl: linkedInResult.url,
                title: linkedInResult.title || '',
            }
        }

        console.log('[LinkedIn Search] No LinkedIn profile URL found in results')
        return { success: true, linkedInUrl: null }
    } catch (error) {
        console.error('[LinkedIn Search] Tavily search failed:', error.message)
        throw new Error('LinkedIn search failed: ' + error.message)
    }
}

module.exports = { enrichContactViaLinkedIn, searchLinkedInProfile, ENRICHMENT_GOLD_COST, SEARCH_GOLD_COST }
