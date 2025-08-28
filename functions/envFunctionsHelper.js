const envFunctions = require('./env_functions.json')

const getEnvFunctions = () => {
    console.log('Loading environment functions...')
    console.log('Available keys in env_functions.json:', Object.keys(envFunctions))
    console.log('PERPLEXITY_API_KEY available:', !!envFunctions.PERPLEXITY_API_KEY)
    console.log('STRIPE_SECRET_KEY available:', !!envFunctions.STRIPE_SECRET_KEY)
    if (!envFunctions.PERPLEXITY_API_KEY) {
        console.warn('Warning: PERPLEXITY_API_KEY is not set in env_functions.json')
    }
    if (!envFunctions.STRIPE_SECRET_KEY) {
        console.warn('Warning: STRIPE_SECRET_KEY is not set in env_functions.json')
    }
    return envFunctions
}

module.exports = { getEnvFunctions }
