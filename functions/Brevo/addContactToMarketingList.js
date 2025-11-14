'use strict'

const { getEnvFunctions } = require('../envFunctionsHelper')
const admin = require('firebase-admin')

/**
 * Get the user's language index for SendinBlue/Brevo
 * Maps browser language to Brevo's expected format
 */
const getUserLanguageIndexForBrevo = () => {
    // This function is typically called from the client, but we'll use a default here
    // In production, pass the language from the client
    return '1' // Default to English
}

/**
 * Get template ID if user signed up via a template project
 * @param {string} initialUrl - The initial URL the user visited
 * @returns {Promise<string>} Template project ID or empty string
 */
const getTemplateIdWhenSignUp = async initialUrl => {
    if (initialUrl) {
        const projectId = initialUrl.split('/')[2]
        if (projectId) {
            try {
                const db = admin.firestore()
                const projectDoc = await db.doc(`/projects/${projectId}`).get()
                const project = projectDoc.data()
                if (project && project.isTemplate) {
                    return projectId
                }
            } catch (error) {
                console.error('Error fetching template project:', error)
            }
        }
    }
    return ''
}

/**
 * Add a contact to the Brevo marketing list
 * @param {Object} data - Function parameters
 * @param {string} data.email - User email address
 * @param {string} data.initialUrl - Initial URL for template detection
 * @param {string} data.languageIndex - User's language preference (optional)
 * @param {string} data.userId - User ID to store as EXT_ID (optional)
 * @returns {Promise<Object>} Result object
 */
const addContactToMarketingList = async data => {
    const { SIB_API_KEY, SIB_MARKETING_SERVICE_LIST } = getEnvFunctions()

    if (!SIB_API_KEY) {
        throw new Error('SIB_API_KEY is not configured')
    }

    const { email, initialUrl, languageIndex, userId } = data

    if (!email) {
        throw new Error('Email is required')
    }

    try {
        const templateId = await getTemplateIdWhenSignUp(initialUrl)

        // Get marketing list ID from environment
        const listId = parseInt(SIB_MARKETING_SERVICE_LIST, 10)
        const userLanguageIndex = languageIndex || getUserLanguageIndexForBrevo()

        // Prepare the payload
        const payload = {
            email,
            listIds: [listId],
            attributes: {
                LANGUAGE: userLanguageIndex,
                SOURCE: 'Alldone',
                EXT_ID: userId || '',
            },
            updateEnabled: true,
        }

        console.log('==================== BREVO API CALL ====================')
        console.log('Endpoint: https://api.sendinblue.com/v3/contacts')
        console.log('Method: POST')
        console.log('Headers: accept: application/json, content-type: application/json')
        console.log('Payload being sent to Brevo:')
        console.log(JSON.stringify(payload, null, 2))
        console.log('Additional context:', {
            templateId,
            hasUserId: !!userId,
            hasLanguageIndex: !!languageIndex,
        })
        console.log('=======================================================')

        const response = await fetch('https://api.sendinblue.com/v3/contacts', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'api-key': SIB_API_KEY,
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('==================== BREVO API ERROR ====================')
            console.error('Status:', response.status, response.statusText)
            console.error('Email:', email)
            console.error('Error response:', errorText)
            console.error('========================================================')
            throw new Error(`Brevo API error: ${response.status} - ${errorText}`)
        }

        // Brevo API returns 204 (No Content) for updates, 201 for creates
        // Only parse JSON if there's content
        let result = null
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
            const text = await response.text()
            if (text) {
                result = JSON.parse(text)
            }
        }

        console.log('==================== BREVO API SUCCESS ====================')
        console.log('Status:', response.status, response.statusText)
        console.log('Email:', email)
        console.log('Response:', result ? JSON.stringify(result, null, 2) : 'No content returned (204)')
        console.log('===========================================================')

        return {
            success: true,
            email,
            result: result || { message: 'Contact added/updated successfully' },
        }
    } catch (error) {
        console.error('==================== BREVO API EXCEPTION ====================')
        console.error('Email:', email)
        console.error('Error message:', error.message)
        console.error('Stack trace:', error.stack)
        console.error('=============================================================')
        throw error
    }
}

module.exports = { addContactToMarketingList }
