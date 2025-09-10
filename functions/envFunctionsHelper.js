const fs = require('fs')
const path = require('path')

// Load environment variables from .env file in emulator mode
if (process.env.FUNCTIONS_EMULATOR) {
    require('dotenv').config()
}

const getEnvFunctions = () => {
    console.log('Loading environment functions...')

    let envFunctions = {}

    // First, try to load from env_functions.json (CI/CD deployed environments)
    const envJsonPath = path.join(__dirname, 'env_functions.json')
    if (fs.existsSync(envJsonPath)) {
        try {
            const envJson = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'))
            console.log('Loading environment from env_functions.json')
            envFunctions = {
                PERPLEXITY_API_KEY: envJson.PERPLEXITY_API_KEY || '',
                STRIPE_SECRET_KEY: envJson.STRIPE_SECRET_KEY || '',
                GOOGLE_FIREBASE_DEPLOY_TOKEN: envJson.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
                OPEN_AI_KEY: envJson.OPENAI_API_KEY || envJson.OPEN_AI_KEY || '',
                TWILIO_ACCOUNT_SID: envJson.TWILIO_ACCOUNT_SID || '',
                TWILIO_AUTH_TOKEN: envJson.TWILIO_AUTH_TOKEN || '',
                TWILIO_WHATSAPP_FROM: envJson.TWILIO_WHATSAPP_FROM || '',
                ALGOLIA_APP_ID: envJson.ALGOLIA_APP_ID || '',
                ALGOLIA_ADMIN_API_KEY: envJson.ALGOLIA_ADMIN_API_KEY || '',
            }
        } catch (error) {
            console.error('Error reading env_functions.json:', error)
            console.log('Falling back to process.env')
        }
    }

    // If no JSON file or it failed to load, fall back to process.env (emulator/local development)
    if (Object.keys(envFunctions).length === 0 || !Object.values(envFunctions).some(val => val)) {
        console.log('Loading environment from process.env')
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
    }

    console.log(
        'Available environment variables:',
        Object.keys(envFunctions).filter(key => envFunctions[key])
    )
    console.log('PERPLEXITY_API_KEY available:', !!envFunctions.PERPLEXITY_API_KEY)
    console.log('STRIPE_SECRET_KEY available:', !!envFunctions.STRIPE_SECRET_KEY)
    console.log('OPENAI_API_KEY available:', !!envFunctions.OPEN_AI_KEY)
    console.log('TWILIO credentials available:', !!(envFunctions.TWILIO_ACCOUNT_SID && envFunctions.TWILIO_AUTH_TOKEN))
    console.log('ALGOLIA_APP_ID available:', !!envFunctions.ALGOLIA_APP_ID)
    console.log('ALGOLIA_ADMIN_API_KEY available:', !!envFunctions.ALGOLIA_ADMIN_API_KEY)

    if (!envFunctions.PERPLEXITY_API_KEY) {
        console.warn('Warning: PERPLEXITY_API_KEY is not set')
    }
    if (!envFunctions.STRIPE_SECRET_KEY) {
        console.warn('Warning: STRIPE_SECRET_KEY is not set')
    }
    if (!envFunctions.OPEN_AI_KEY) {
        console.warn('Warning: OPENAI_API_KEY is not set')
    }
    if (!envFunctions.ALGOLIA_APP_ID) {
        console.warn('Warning: ALGOLIA_APP_ID is not set')
    }
    if (!envFunctions.ALGOLIA_ADMIN_API_KEY) {
        console.warn('Warning: ALGOLIA_ADMIN_API_KEY is not set')
    }

    return envFunctions
}

module.exports = { getEnvFunctions }
