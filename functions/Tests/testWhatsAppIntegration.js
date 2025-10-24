/**
 * Test script for WhatsApp integration
 * Run this script to test if WhatsApp configuration is working correctly
 */

// Load environment variables from .env file
require('dotenv').config()

const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')

async function testWhatsAppConfiguration() {
    console.log('🧪 Starting WhatsApp Integration Test...\n')

    const whatsappService = new TwilioWhatsAppService()

    // Check environment variables
    console.log('📋 Environment Check:')
    console.log(`- TWILIO_ACCOUNT_SID: ${process.env.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Missing'}`)
    console.log(`- TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Missing'}`)
    console.log(`- TWILIO_WHATSAPP_FROM: ${process.env.TWILIO_WHATSAPP_FROM || 'Using default sandbox number'}`)
    console.log('')

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.log('❌ Missing required Twilio environment variables.')
        console.log('Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN')
        console.log('See WHATSAPP_ENVIRONMENT_SETUP.md for setup instructions')
        return false
    }

    // Test phone number - you should replace this with your actual test number
    const testPhoneNumber = process.env.TEST_WHATSAPP_NUMBER || '+1234567890'

    if (testPhoneNumber === '+1234567890') {
        console.log('⚠️  Using default test phone number (+1234567890)')
        console.log('Set TEST_WHATSAPP_NUMBER environment variable with your actual WhatsApp number')
        console.log('Format: +1234567890 (with country code)\n')
    }

    try {
        console.log('📱 Testing WhatsApp message sending...')
        console.log(`Sending test message to: ${testPhoneNumber}`)

        const result = await whatsappService.testConfiguration(testPhoneNumber)

        if (result.success) {
            console.log('✅ WhatsApp test message sent successfully!')
            console.log(`Message SID: ${result.sid}`)
            console.log(`Status: ${result.status}`)
            console.log('')
            console.log('📝 Note: Check your WhatsApp to confirm message delivery.')
            console.log("If using Twilio sandbox, make sure you've joined the sandbox first.")
            return true
        } else {
            console.log('❌ WhatsApp test message failed:')
            console.log(`Error: ${result.error}`)
            console.log(`Code: ${result.code}`)
            console.log('')
            console.log('🔍 Common solutions:')
            console.log('- Verify phone number format includes country code')
            console.log('- For sandbox: Send "join <code>" to Twilio WhatsApp number first')
            console.log('- Check Twilio console for detailed error logs')
            return false
        }
    } catch (error) {
        console.log('❌ Test failed with exception:')
        console.log(`Error: ${error.message}`)
        console.log('')
        console.log('🔍 Check your Twilio credentials and try again')
        return false
    }
}

async function testTaskCompletionNotification() {
    console.log('📋 Testing Task Completion Notification...')

    const whatsappService = new TwilioWhatsAppService()
    const testPhoneNumber = process.env.TEST_WHATSAPP_NUMBER || '+1234567890'

    // Mock test data
    const mockUserId = process.env.TEST_USER_ID || 'test-user-123'
    const mockProjectId = process.env.TEST_PROJECT_ID || 'test-project-456'
    const mockTaskId = process.env.TEST_TASK_ID || 'test-task-789'

    const mockTaskData = {
        name: 'Test Assistant Task',
        recurrence: 'daily',
        type: 'recurring',
    }

    const mockResult =
        'This is a test result from the Alldone Assistant. The task has been completed successfully with this sample output.'

    try {
        const result = await whatsappService.sendTaskCompletionNotification(
            testPhoneNumber,
            mockUserId,
            mockProjectId,
            mockTaskId,
            mockTaskData,
            mockResult
        )

        if (result.success) {
            console.log('✅ Task completion notification sent successfully!')
            console.log(`Message SID: ${result.sid}`)
            return true
        } else {
            console.log('❌ Task completion notification failed:')
            console.log(`Error: ${result.error}`)
            return false
        }
    } catch (error) {
        console.log('❌ Task completion test failed:')
        console.log(`Error: ${error.message}`)
        return false
    }
}

// Main test runner
async function runTests() {
    console.log('🚀 Alldone WhatsApp Integration Test Suite')
    console.log('==========================================\n')

    try {
        // Test 1: Basic Configuration Test
        const configTest = await testWhatsAppConfiguration()

        if (configTest) {
            console.log('==========================================\n')

            // Test 2: Task Completion Notification Test
            const taskTest = await testTaskCompletionNotification()

            console.log('==========================================\n')
            console.log('📊 Test Summary:')
            console.log(`- Configuration Test: ${configTest ? '✅ Pass' : '❌ Fail'}`)
            console.log(`- Task Notification Test: ${taskTest ? '✅ Pass' : '❌ Fail'}`)

            if (configTest && taskTest) {
                console.log('\n🎉 All tests passed! WhatsApp integration is ready.')
            } else {
                console.log('\n⚠️  Some tests failed. Please check the errors above.')
            }
        } else {
            console.log('\n❌ Configuration test failed. Skipping additional tests.')
        }
    } catch (error) {
        console.log(`\n💥 Test suite crashed: ${error.message}`)
    }

    console.log('\n📚 For help, see: WHATSAPP_ENVIRONMENT_SETUP.md')
}

// Export for use in other contexts
module.exports = {
    testWhatsAppConfiguration,
    testTaskCompletionNotification,
    runTests,
}

// Run tests if this script is executed directly
if (require.main === module) {
    runTests()
}
