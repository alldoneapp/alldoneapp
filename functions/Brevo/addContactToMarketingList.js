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
 * @returns {Promise<Object>} Result object
 */
const addContactToMarketingList = async data => {
    const { SIB_API_KEY, SIB_MARKETING_SERVICE_LIST } = getEnvFunctions()

    if (!SIB_API_KEY) {
        throw new Error('SIB_API_KEY is not configured')
    }

    const { email, initialUrl, languageIndex } = data

    if (!email) {
        throw new Error('Email is required')
    }

    try {
        const templateId = await getTemplateIdWhenSignUp(initialUrl)

        // Get marketing list ID from environment
        const listId = parseInt(SIB_MARKETING_SERVICE_LIST, 10)
        const userLanguageIndex = languageIndex || getUserLanguageIndexForBrevo()

        console.log('Adding contact to Brevo marketing list:', {
            email,
            listId,
            templateId,
            languageIndex: userLanguageIndex,
        })

        const response = await fetch('https://api.sendinblue.com/v3/contacts', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'api-key': SIB_API_KEY,
            },
            body: JSON.stringify({
                email,
                listIds: [listId],
                attributes: {
                    LANGUAGE: userLanguageIndex,
                    templateId,
                    SOURCE: 'Alldone',
                },
                updateEnabled: true,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('Brevo API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                email,
            })
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

        console.log('Successfully added contact to Brevo:', email, result || 'No content returned')

        return {
            success: true,
            email,
            result: result || { message: 'Contact added/updated successfully' },
        }
    } catch (error) {
        console.error('Failed to add contact to Brevo marketing list:', {
            error: error.message,
            stack: error.stack,
            email,
        })
        throw error
    }
}

module.exports = { addContactToMarketingList }
