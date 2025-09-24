const fs = require('fs')
const path = require('path')

// Load environment variables from .env file in emulator mode
if (process.env.FUNCTIONS_EMULATOR) {
    require('dotenv').config()
}

// Helper function to detect placeholder values
function isPlaceholderValue(value) {
    if (!value || value === '') return true
    const placeholderPatterns = [
        /^your_.*_here$/i,
        /^replace_.*$/i,
        /^placeholder$/i,
        /^example_.*$/i,
        /^test_.*$/i,
        /^dummy_.*$/i,
    ]
    return placeholderPatterns.some(pattern => pattern.test(value))
}

// Helper function to check if environment object has real (non-placeholder) values
function hasRealValues(envObject) {
    return Object.values(envObject).some(val => val && !isPlaceholderValue(val))
}

const getEnvFunctions = () => {
    console.log('Loading environment functions...')

    const isEmulator = !!process.env.FUNCTIONS_EMULATOR
    console.log('Environment detection:', {
        FUNCTIONS_EMULATOR: isEmulator,
        NODE_ENV: process.env.NODE_ENV,
    })

    let envFunctions = {}
    let source = 'none'

    // In emulator mode, prioritize process.env (from .env file)
    if (isEmulator) {
        console.log('🔧 EMULATOR MODE: Loading from process.env (.env file)')
        source = 'process.env (.env file)'
        envFunctions = {
            PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
            STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
            GOOGLE_FIREBASE_DEPLOY_TOKEN: process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
            OPEN_AI_KEY: process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || '',
            TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
            TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
            TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || '',
            ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID || '',
            ALGOLIA_ADMIN_API_KEY: process.env.ALGOLIA_ADMIN_API_KEY || '',
        }
    } else {
        // In production/staging, try to load from env_functions.json first
        const envJsonPath = path.join(__dirname, 'env_functions.json')
        if (fs.existsSync(envJsonPath)) {
            try {
                const envJson = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'))
                console.log('🌐 PRODUCTION/STAGING: Attempting to load from env_functions.json')

                const jsonEnvFunctions = {
                    PERPLEXITY_API_KEY: envJson.PERPLEXITY_API_KEY || '',
                    STRIPE_SECRET_KEY: envJson.STRIPE_SECRET_KEY || '',
                    GOOGLE_FIREBASE_DEPLOY_TOKEN: envJson.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
                    OPEN_AI_KEY: envJson.OPENAI_API_KEY || envJson.OPEN_AI_KEY || '',
                    TWILIO_ACCOUNT_SID: envJson.TWILIO_ACCOUNT_SID || '',
                    TWILIO_AUTH_TOKEN: envJson.TWILIO_AUTH_TOKEN || '',
                    TWILIO_WHATSAPP_FROM: envJson.TWILIO_WHATSAPP_FROM || '',
                    ALGOLIA_APP_ID: envJson.ALGOLIA_APP_ID || '',
                    ALGOLIA_ADMIN_API_KEY: envJson.ALGOLIA_ADMIN_API_KEY || '',
                    GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET: envJson.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET || '',
                }

                // Check if JSON file has real values or just placeholders
                if (hasRealValues(jsonEnvFunctions)) {
                    envFunctions = jsonEnvFunctions
                    source = 'env_functions.json (CI/CD)'
                    console.log('✅ Using real values from env_functions.json')
                } else {
                    console.log('⚠️  env_functions.json contains only placeholders, falling back to process.env')
                    source = 'process.env (fallback from placeholders)'
                    envFunctions = {
                        PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
                        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
                        GOOGLE_FIREBASE_DEPLOY_TOKEN: process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
                        OPEN_AI_KEY: process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || '',
                        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
                        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
                        TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || '',
                        ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID || '',
                        ALGOLIA_ADMIN_API_KEY: process.env.ALGOLIA_ADMIN_API_KEY || '',
                        GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET:
                            process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET || '',
                    }
                }
            } catch (error) {
                console.error('Error reading env_functions.json:', error)
                console.log('Falling back to process.env')
                source = 'process.env (fallback from JSON error)'
                envFunctions = {
                    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
                    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
                    GOOGLE_FIREBASE_DEPLOY_TOKEN: process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
                    OPEN_AI_KEY: process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || '',
                    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
                    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
                    TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || '',
                    ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID || '',
                    ALGOLIA_ADMIN_API_KEY: process.env.ALGOLIA_ADMIN_API_KEY || '',
                    GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET:
                        process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET || '',
                }
            }
        } else {
            // No JSON file, use process.env
            console.log('📄 No env_functions.json found, using process.env')
            source = 'process.env (no JSON file)'
            envFunctions = {
                PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
                STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
                GOOGLE_FIREBASE_DEPLOY_TOKEN: process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
                OPEN_AI_KEY: process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || '',
                TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
                TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
                TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || '',
                ALGOLIA_APP_ID: process.env.ALGOLIA_APP_ID || '',
                ALGOLIA_ADMIN_API_KEY: process.env.ALGOLIA_ADMIN_API_KEY || '',
                GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET: process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET || '',
            }
        }
    }

    // Enhanced logging with source information
    console.log(`📋 Environment loaded from: ${source}`)
    console.log(
        'Available environment variables:',
        Object.keys(envFunctions).filter(key => envFunctions[key] && !isPlaceholderValue(envFunctions[key]))
    )
    console.log(
        'PERPLEXITY_API_KEY available:',
        !!(envFunctions.PERPLEXITY_API_KEY && !isPlaceholderValue(envFunctions.PERPLEXITY_API_KEY))
    )
    console.log(
        'STRIPE_SECRET_KEY available:',
        !!(envFunctions.STRIPE_SECRET_KEY && !isPlaceholderValue(envFunctions.STRIPE_SECRET_KEY))
    )
    console.log(
        'OPENAI_API_KEY available:',
        !!(envFunctions.OPEN_AI_KEY && !isPlaceholderValue(envFunctions.OPEN_AI_KEY))
    )
    console.log(
        'TWILIO credentials available:',
        !!(
            envFunctions.TWILIO_ACCOUNT_SID &&
            !isPlaceholderValue(envFunctions.TWILIO_ACCOUNT_SID) &&
            envFunctions.TWILIO_AUTH_TOKEN &&
            !isPlaceholderValue(envFunctions.TWILIO_AUTH_TOKEN)
        )
    )
    console.log(
        'ALGOLIA_APP_ID available:',
        !!(envFunctions.ALGOLIA_APP_ID && !isPlaceholderValue(envFunctions.ALGOLIA_APP_ID))
    )
    console.log(
        'ALGOLIA_ADMIN_API_KEY available:',
        !!(envFunctions.ALGOLIA_ADMIN_API_KEY && !isPlaceholderValue(envFunctions.ALGOLIA_ADMIN_API_KEY))
    )

    if (!envFunctions.PERPLEXITY_API_KEY || isPlaceholderValue(envFunctions.PERPLEXITY_API_KEY)) {
        console.warn('Warning: PERPLEXITY_API_KEY is not set or is a placeholder')
    }
    if (!envFunctions.STRIPE_SECRET_KEY || isPlaceholderValue(envFunctions.STRIPE_SECRET_KEY)) {
        console.warn('Warning: STRIPE_SECRET_KEY is not set or is a placeholder')
    }
    if (!envFunctions.OPEN_AI_KEY || isPlaceholderValue(envFunctions.OPEN_AI_KEY)) {
        console.warn('Warning: OPENAI_API_KEY is not set or is a placeholder')
    }
    if (!envFunctions.ALGOLIA_APP_ID || isPlaceholderValue(envFunctions.ALGOLIA_APP_ID)) {
        console.warn('Warning: ALGOLIA_APP_ID is not set or is a placeholder')
    }
    if (!envFunctions.ALGOLIA_ADMIN_API_KEY || isPlaceholderValue(envFunctions.ALGOLIA_ADMIN_API_KEY)) {
        console.warn('Warning: ALGOLIA_ADMIN_API_KEY is not set or is a placeholder')
    }

    return envFunctions
}

module.exports = { getEnvFunctions }
