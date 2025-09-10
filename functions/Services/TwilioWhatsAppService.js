const admin = require('firebase-admin')
const { getEnvFunctions } = require('../envFunctionsHelper')

/**
 * Service for sending WhatsApp messages using Twilio API
 */
class TwilioWhatsAppService {
    constructor() {
        // Load environment variables using our unified helper
        const envFunctions = getEnvFunctions()

        this.twilioAccountSid = envFunctions.TWILIO_ACCOUNT_SID
        this.twilioAuthToken = envFunctions.TWILIO_AUTH_TOKEN
        this.twilioWhatsAppFrom = envFunctions.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'

        // Initialize Twilio client lazily
        this.client = null
    }

    /**
     * Initialize Twilio client
     * @private
     */
    _initializeTwilioClient() {
        if (!this.client) {
            if (!this.twilioAccountSid || !this.twilioAuthToken) {
                throw new Error(
                    'Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.'
                )
            }

            const twilio = require('twilio')
            this.client = twilio(this.twilioAccountSid, this.twilioAuthToken)
        }
        return this.client
    }

    /**
     * Format phone number for WhatsApp (must include country code and whatsapp: prefix)
     * @param {string} phoneNumber - Phone number to format
     * @returns {string} - Formatted WhatsApp phone number
     * @private
     */
    _formatWhatsAppNumber(phoneNumber) {
        if (!phoneNumber) {
            throw new Error('Phone number is required')
        }

        // Remove any existing whatsapp: prefix
        let cleanNumber = phoneNumber.replace(/^whatsapp:/, '')

        // Remove all non-numeric characters except +
        cleanNumber = cleanNumber.replace(/[^\d+]/g, '')

        // Add + if not present and number doesn't start with it
        if (!cleanNumber.startsWith('+')) {
            cleanNumber = '+' + cleanNumber
        }

        // Add whatsapp: prefix
        return `whatsapp:${cleanNumber}`
    }

    /**
     * Send WhatsApp message
     * @param {string} to - Recipient phone number
     * @param {string} message - Message content
     * @returns {Promise<Object>} - Twilio message response
     */
    async sendWhatsAppMessage(to, message) {
        try {
            const client = this._initializeTwilioClient()
            const formattedTo = this._formatWhatsAppNumber(to)

            console.log('Sending WhatsApp message:', {
                from: this.twilioWhatsAppFrom,
                to: formattedTo,
                messageLength: message.length,
                timestamp: new Date().toISOString(),
            })

            const response = await client.messages.create({
                from: this.twilioWhatsAppFrom,
                to: formattedTo,
                body: message,
            })

            console.log('WhatsApp message sent successfully:', {
                sid: response.sid,
                status: response.status,
                to: formattedTo,
                timestamp: new Date().toISOString(),
            })

            return {
                success: true,
                sid: response.sid,
                status: response.status,
                to: formattedTo,
                message: 'WhatsApp message sent successfully',
            }
        } catch (error) {
            console.error('Failed to send WhatsApp message:', {
                error: error.message,
                code: error.code,
                status: error.status,
                to,
                timestamp: new Date().toISOString(),
                stack: error.stack,
            })

            return {
                success: false,
                error: error.message,
                code: error.code,
                status: error.status,
                to,
                message: 'Failed to send WhatsApp message',
            }
        }
    }

    /**
     * Send task completion notification via WhatsApp using Content Template
     * @param {string} userPhone - User's phone number
     * @param {Object} taskData - Task information
     * @param {string} taskResult - AI-generated task result
     * @param {string} appUrl - URL back to the app
     * @returns {Promise<Object>} - Send result
     */
    async sendTaskCompletionNotification(
        userPhone,
        taskData,
        taskResult = '',
        appUrl = 'https://alldonealeph.web.app'
    ) {
        if (!userPhone) {
            console.warn('No phone number provided for WhatsApp notification')
            return {
                success: false,
                error: 'No phone number provided',
                message: 'User phone number is required for WhatsApp notifications',
            }
        }

        try {
            const client = this._initializeTwilioClient()
            const formattedTo = this._formatWhatsAppNumber(userPhone)

            // Truncate result for WhatsApp message (limit to 1000 chars)
            const truncatedResult = taskResult.length > 1000 ? taskResult.substring(0, 1000) + '...' : taskResult

            // Content variables for the template - only task result is needed
            const contentVariables = JSON.stringify({
                1: truncatedResult || 'Task completed successfully',
            })

            console.log('Sending WhatsApp message with Content Template:', {
                from: this.twilioWhatsAppFrom,
                to: formattedTo,
                contentSid: 'HXc38ef95cc1d0b10aad7186d7ec0a8961',
                contentVariables,
                timestamp: new Date().toISOString(),
            })

            const response = await client.messages.create({
                contentSid: 'HXc38ef95cc1d0b10aad7186d7ec0a8961',
                contentVariables,
                from: this.twilioWhatsAppFrom,
                to: formattedTo,
            })

            console.log('WhatsApp message sent successfully with template:', {
                sid: response.sid,
                status: response.status,
                to: formattedTo,
                timestamp: new Date().toISOString(),
            })

            return {
                success: true,
                sid: response.sid,
                status: response.status,
                to: formattedTo,
                message: 'WhatsApp message sent successfully using content template',
            }
        } catch (error) {
            console.error('Failed to send WhatsApp message with template:', {
                error: error.message,
                code: error.code,
                status: error.status,
                userPhone,
                taskName: taskData?.name,
                timestamp: new Date().toISOString(),
                stack: error.stack,
            })

            return {
                success: false,
                error: error.message,
                code: error.code,
                status: error.status,
                to: userPhone,
                message: 'Failed to send WhatsApp message with content template',
            }
        }
    }

    /**
     * Test WhatsApp configuration
     * @param {string} testPhoneNumber - Phone number to send test message to
     * @returns {Promise<Object>} - Test result
     */
    async testConfiguration(testPhoneNumber) {
        const testMessage = `🧪 *Alldone WhatsApp Test*

This is a test message to verify your WhatsApp integration is working correctly.

✅ Configuration is successful!
🕒 ${new Date().toISOString()}

Powered by Alldone Assistant 🚀`

        return await this.sendWhatsAppMessage(testPhoneNumber, testMessage)
    }
}

module.exports = TwilioWhatsAppService
