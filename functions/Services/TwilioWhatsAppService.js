const admin = require('firebase-admin')

/**
 * Service for sending WhatsApp messages using Twilio API
 */
class TwilioWhatsAppService {
    constructor() {
        // Load environment variables from .env file if in emulator
        if (process.env.FUNCTIONS_EMULATOR) {
            require('dotenv').config()
        }

        // Try Firebase Functions config first, then environment variables
        const functions = require('firebase-functions')

        this.twilioAccountSid = functions.config().twilio?.account_sid || process.env.TWILIO_ACCOUNT_SID
        this.twilioAuthToken = functions.config().twilio?.auth_token || process.env.TWILIO_AUTH_TOKEN
        this.twilioWhatsAppFrom =
            functions.config().twilio?.whatsapp_from || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'

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
     * Send task completion notification via WhatsApp
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
            // Create message content
            const taskType = taskData.recurrence && taskData.recurrence !== 'never' ? 'Recurring' : 'One-time'
            const completionTime = new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            })

            // Truncate result for WhatsApp message (WhatsApp has 1600 char limit)
            const truncatedResult = taskResult.length > 300 ? taskResult.substring(0, 300) + '...' : taskResult

            const message = `🤖 *Alldone Task Completed*

📋 *Task:* ${taskData.name}
⏰ *Type:* ${taskType} task
🕒 *Completed:* ${completionTime} UTC

${truncatedResult ? `📝 *Result:*\n${truncatedResult}\n\n` : ''}📱 View full details: ${appUrl}

Powered by Alldone Assistant 🚀`

            return await this.sendWhatsAppMessage(userPhone, message)
        } catch (error) {
            console.error('Error creating task completion WhatsApp message:', {
                error: error.message,
                userPhone,
                taskName: taskData?.name,
                timestamp: new Date().toISOString(),
            })

            return {
                success: false,
                error: error.message,
                message: 'Failed to create task completion notification',
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
