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

module.exports = { enrichContactViaLinkedIn, ENRICHMENT_GOLD_COST }
