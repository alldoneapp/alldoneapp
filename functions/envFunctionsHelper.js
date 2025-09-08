// Load environment variables from .env file in emulator mode
if (process.env.FUNCTIONS_EMULATOR) {
    require('dotenv').config()
}

const getEnvFunctions = () => {
    console.log('Loading environment functions...')

    // Create environment object from process.env
    const envFunctions = {
        PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
        GOOGLE_FIREBASE_DEPLOY_TOKEN: process.env.GOOGLE_FIREBASE_DEPLOY_TOKEN || '',
        OPEN_AI_KEY: process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || '',
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
        TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || '',
    }

    console.log(
        'Available environment variables:',
        Object.keys(envFunctions).filter(key => envFunctions[key])
    )
    console.log('PERPLEXITY_API_KEY available:', !!envFunctions.PERPLEXITY_API_KEY)
    console.log('STRIPE_SECRET_KEY available:', !!envFunctions.STRIPE_SECRET_KEY)
    console.log('OPENAI_API_KEY available:', !!envFunctions.OPEN_AI_KEY)
    console.log('TWILIO credentials available:', !!(envFunctions.TWILIO_ACCOUNT_SID && envFunctions.TWILIO_AUTH_TOKEN))

    if (!envFunctions.PERPLEXITY_API_KEY) {
        console.warn('Warning: PERPLEXITY_API_KEY is not set')
    }
    if (!envFunctions.STRIPE_SECRET_KEY) {
        console.warn('Warning: STRIPE_SECRET_KEY is not set')
    }
    if (!envFunctions.OPEN_AI_KEY) {
        console.warn('Warning: OPENAI_API_KEY is not set')
    }

    return envFunctions
}

module.exports = { getEnvFunctions }
