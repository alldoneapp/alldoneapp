'use strict'
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { log } = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')

const admin = require('firebase-admin')
const firebaseConfig = require('./firebaseConfig.js')

// Helper function to get the correct base URL based on environment
function getBaseUrl() {
    if (process.env.FUNCTIONS_EMULATOR) {
        return 'http://localhost:5000'
    }

    // Prefer deriving environment from the Functions runtime project ID
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }
    if (!projectId) {
        try {
            const admin = require('firebase-admin')
            projectId = (admin.app() && admin.app().options && admin.app().options.projectId) || undefined
        } catch (_) {}
    }

    if (projectId === 'alldonealeph') {
        return 'https://my.alldone.app'
    }
    if (projectId === 'alldonestaging') {
        return 'https://mystaging.alldone.app'
    }

    return 'https://my.alldone.app'
}

// Guard against duplicate initialization during Firebase CLI code analysis
try {
    admin.app()
} catch (e) {
    firebaseConfig.init(admin)
}

// MCP SERVER (defer ESM-only deps to runtime)

exports.mcpServer = onRequest(
    {
        timeoutSeconds: 300,
        memory: '1GiB',
        region: 'europe-west1',
        cors: {
            origin: true, // Allow all origins for debugging
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
            allowedHeaders: ['*'],
            credentials: false, // Must be false when allowing all origins
        },
    },
    async (req, res) => {
        // Reuse a singleton MCP server instance so SSE connections persist across invocations
        if (!global.__ALldoneMcpServer) {
            const imported = await import('./MCP/mcpServerSimple.js')
            const AlldoneSimpleMCPServer = imported.AlldoneSimpleMCPServer || imported.default?.AlldoneSimpleMCPServer
            if (!AlldoneSimpleMCPServer) {
                console.error('Failed to load AlldoneSimpleMCPServer export from mcpServerSimple.js')
                res.status(500).json({ error: 'Server initialization error from mcpServerSimple.js' })
                return
            }
            global.__ALldoneMcpServer = new AlldoneSimpleMCPServer()
        }
        await global.__ALldoneMcpServer.handleRequest(req, res)
    }
)

// Root-level OAuth metadata endpoints for MCP Inspector
// This function handles requests to https://domain/.well-known/oauth-*
exports.wellKnownOAuth = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        console.log('Root OAuth metadata request:', req.path, req.url)

        const baseUrl = getBaseUrl()

        // Handle authorization server metadata
        if (req.path === '/.well-known/oauth-authorization-server' || req.url?.includes('oauth-authorization-server')) {
            res.json({
                issuer: baseUrl,
                authorization_endpoint: `${baseUrl}/authorize`,
                token_endpoint: `${baseUrl}/token`,
                registration_endpoint: `${baseUrl}/register`,
                scopes_supported: ['read', 'write', 'mcp:tools'],
                response_types_supported: ['code'],
                grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
                subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['RS256'],
                code_challenge_methods_supported: ['S256'],
                // MCP-specific guidance
                'x-mcp-recommended-flow': 'client_credentials',
                'x-mcp-auth-instructions': 'For MCP clients: Use client_credentials grant with api_key parameter',
            })
            return
        }

        // Handle protected resource metadata
        if (req.path === '/.well-known/oauth-protected-resource' || req.url?.includes('oauth-protected-resource')) {
            res.json({
                resource: baseUrl,
                authorization_servers: [baseUrl],
                scopes_supported: ['read', 'write', 'mcp:tools'],
                bearer_methods_supported: ['header'],
                resource_documentation: 'https://modelcontextprotocol.io',
            })
            return
        }

        res.status(404).json({ error: 'OAuth metadata endpoint not found' })
    }
)

// WORKAROUND: Root-level OAuth metadata for MCP Inspector bug
// See: https://github.com/modelcontextprotocol/typescript-sdk/issues/545
// The MCP Inspector incorrectly drops base paths when constructing OAuth metadata URLs
exports.oauthAuthorizationServer = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        console.log('Root-level OAuth authorization server metadata request')

        const baseUrl = getBaseUrl()

        res.json({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            registration_endpoint: `${baseUrl}/register`,
            scopes_supported: ['read', 'write', 'mcp:tools'],
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256'],
            // MCP-specific guidance
            'x-mcp-recommended-flow': 'client_credentials',
            'x-mcp-auth-instructions': 'For MCP clients: Use client_credentials grant with api_key parameter',
        })
    }
)

exports.oauthProtectedResource = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        console.log('Root-level OAuth protected resource metadata request')

        const baseUrl = getBaseUrl()

        res.json({
            resource: `${baseUrl}/mcpServer`,
            authorization_servers: [`${baseUrl}/mcpServer`],
            scopes_supported: ['read', 'write', 'mcp:tools'],
            bearer_methods_supported: ['header'],
            resource_documentation: 'https://modelcontextprotocol.io',
        })
    }
)

// Root-level OAuth endpoints that Claude Code expects
// These proxy/redirect to the actual MCP server endpoints

exports.authorize = onRequest(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        console.log('Root-level /authorize request - proxying to MCP server')
        console.log('Query params:', req.query)
        console.log('Headers:', req.headers)

        // Forward to the actual MCP server authorize endpoint
        const mcpServerUrl = `${getBaseUrl()}/mcpServer`

        // Build the target URL with all query parameters
        const targetUrl = new URL(`${mcpServerUrl}/authorize`)
        Object.entries(req.query).forEach(([key, value]) => {
            targetUrl.searchParams.set(key, value)
        })

        try {
            // Forward the request to the MCP server
            const response = await fetch(targetUrl.toString(), {
                method: req.method,
                headers: {
                    Accept: req.headers['accept'] || 'application/json',
                    'User-Agent': req.headers['user-agent'] || 'claude-oauth-proxy',
                    'Content-Type': req.headers['content-type'] || 'application/json',
                },
            })

            // Copy the response
            const responseText = await response.text()

            // Set the same headers
            res.status(response.status)
            response.headers.forEach((value, key) => {
                if (key !== 'content-encoding' && key !== 'transfer-encoding') {
                    res.set(key, value)
                }
            })

            // Send the response
            res.send(responseText)
        } catch (error) {
            console.error('Error proxying to MCP server authorize:', error)
            res.status(500).json({
                error: 'proxy_error',
                error_description: 'Failed to proxy request to MCP server',
                target_url: targetUrl.toString(),
            })
        }
    }
)

exports.token = onRequest(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['POST', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        console.log('Root-level /token request - proxying to MCP server')
        console.log('Body:', req.body)
        console.log('Headers:', req.headers)

        // Forward to the actual MCP server token endpoint
        const mcpServerUrl = `${getBaseUrl()}/mcpServer`

        try {
            const requestInit = {
                method: 'POST',
                headers: {
                    Accept: req.headers['accept'] || 'application/json',
                    'User-Agent': req.headers['user-agent'] || 'claude-oauth-proxy',
                    'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
                },
            }

            // Handle different content types
            if (req.headers['content-type']?.includes('application/json')) {
                requestInit.body = JSON.stringify(req.body)
            } else {
                // Convert body to URL-encoded format
                const params = new URLSearchParams()
                Object.entries(req.body || {}).forEach(([key, value]) => {
                    params.append(key, value)
                })
                requestInit.body = params.toString()
            }

            const response = await fetch(`${mcpServerUrl}/token`, requestInit)
            const responseText = await response.text()

            // Copy the response
            res.status(response.status)
            response.headers.forEach((value, key) => {
                if (key !== 'content-encoding' && key !== 'transfer-encoding') {
                    res.set(key, value)
                }
            })

            res.send(responseText)
        } catch (error) {
            console.error('Error proxying to MCP server token:', error)
            res.status(500).json({
                error: 'proxy_error',
                error_description: 'Failed to proxy request to MCP server',
            })
        }
    }
)

exports.register = onRequest(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['POST', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: false,
        },
    },
    async (req, res) => {
        console.log('Root-level /register request - proxying to MCP server')
        console.log('Body:', req.body)

        // Forward to the actual MCP server register endpoint
        const mcpServerUrl = `${getBaseUrl()}/mcpServer`

        try {
            const response = await fetch(`${mcpServerUrl}/register`, {
                method: 'POST',
                headers: {
                    Accept: req.headers['accept'] || 'application/json',
                    'User-Agent': req.headers['user-agent'] || 'claude-oauth-proxy',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(req.body),
            })

            const responseText = await response.text()

            // Copy the response
            res.status(response.status)
            response.headers.forEach((value, key) => {
                if (key !== 'content-encoding' && key !== 'transfer-encoding') {
                    res.set(key, value)
                }
            })

            res.send(responseText)
        } catch (error) {
            console.error('Error proxying to MCP server register:', error)
            res.status(500).json({
                error: 'proxy_error',
                error_description: 'Failed to proxy request to MCP server',
            })
        }
    }
)

//PAYMENT AND PREMIUM

exports.updateCreditCardNumberSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (auth) {
            const { updateCreditCardNumber } = require('./Payment/SubscriptionsActions')
            const { userPayingId, urlOrigin } = data
            return await updateCreditCardNumber(userPayingId, urlOrigin)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.createCompanySubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (auth) {
            const { createCompanySubscription } = require('./Payment/SubscriptionsActions')
            const {
                customerId,
                userId,
                userName,
                userEmail,
                selectedUserIds,
                companyData,
                paymentMethod,
                urlOrigin,
            } = data

            return await createCompanySubscription(
                customerId,
                userId,
                userName,
                userEmail,
                selectedUserIds,
                companyData,
                paymentMethod,
                urlOrigin
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.removeUserFromSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { removePaidUsersFromSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, userId } = data
            return await removePaidUsersFromSubscription(userPayingId, [userId])
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedPaidUsersToSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedPaidUsersToSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, paidAddedUserIds } = data
            return await addedPaidUsersToSubscription(userPayingId, paidAddedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedPaidUsersWhenActivateSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedPaidUsersWhenActivateSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, paidAddedUserIds } = data
            return await addedPaidUsersWhenActivateSubscription(userPayingId, paidAddedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.removePaidUsersFromSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { removePaidUsersFromSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, removedUserIds } = data
            return await removePaidUsersFromSubscription(userPayingId, removedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedUsersToSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedUsersToSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, newAddedUserIds, newSelectedUserIds, urlOrigin } = data
            return await addedUsersToSubscription(userPayingId, newAddedUserIds, urlOrigin, newSelectedUserIds)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addedUsersWhenActivateSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addedUsersWhenActivateSubscription } = require('./Payment/SubscriptionsActions')
            const { userPayingId, newAddedUserIds, newSelectedUserIds, urlOrigin } = data
            return await addedUsersWhenActivateSubscription(
                userPayingId,
                newAddedUserIds,
                urlOrigin,
                newSelectedUserIds
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.cancelSubscriptionSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { cancelSubscription } = require('./Payment/CancelSubscriptions')
            const { userPayingId } = data
            await cancelSubscription(userPayingId)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.webhookSecondGen = onRequest(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processPaymentStatus(id, res)
    }
)

// STRIPE PREMIUM FUNCTIONS

exports.checkUserPremiumStatus = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { checkUserPremiumStatus } = require('./Premium/stripePremiumChecker')
            // Create v1-compatible context object
            const context = { auth }
            return await checkUserPremiumStatus(data, context)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.createStripePortalSession = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { createStripePortalSession } = require('./Premium/stripePremiumChecker')
            // Create v1-compatible context object
            const context = { auth }
            return await createStripePortalSession(data, context)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addContactToBrevoMarketingList = onCall(
    {
        timeoutSeconds: 30,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addContactToMarketingList } = require('./Brevo/addContactToMarketingList')
            // Add user ID from auth context to the data
            const dataWithUserId = {
                ...data,
                userId: auth.uid,
            }
            return await addContactToMarketingList(dataWithUserId)
        } else {
            throw new HttpsError('permission-denied', 'Authentication required')
        }
    }
)

exports.ipRegistryLookup = onCall(
    {
        timeoutSeconds: 30,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { ipRegistryLookup } = require('./IpRegistry/ipRegistryLookup')
            return await ipRegistryLookup(data)
        } else {
            throw new HttpsError('permission-denied', 'Authentication required')
        }
    }
)

exports.giphyRandomGif = onCall(
    {
        timeoutSeconds: 30,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { giphyRandomGif } = require('./Giphy/giphyRandomGif')
            return await giphyRandomGif(data)
        } else {
            throw new HttpsError('permission-denied', 'Authentication required')
        }
    }
)

exports.linkStripeAccount = onCall(
    {
        timeoutSeconds: 30,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { linkStripeAccount } = require('./Premium/stripePremiumChecker')
            // Create v1-compatible context object
            const context = { auth }
            return await linkStripeAccount(data, context)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.handleStripeWebhook = onRequest(
    {
        timeoutSeconds: 30,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleStripeWebhook } = require('./Premium/stripePremiumChecker')
        return await handleStripeWebhook(req, res)
    }
)

exports.dailyPremiumStatusCheck = onSchedule(
    {
        schedule: '0 2 * * *',
        timeZone: 'UTC',
        memory: '1GiB',
        region: 'europe-west1',
    },
    async context => {
        const { dailyPremiumStatusCheck } = require('./Premium/stripePremiumChecker')
        return await dailyPremiumStatusCheck(context)
    }
)

exports.webhook = onRequest(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processPaymentStatus(id, res, process.env.GCLOUD_PROJECT)
    }
)

exports.updateMollieSubscription = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { updateMollieSubscription } = require('./Payment/Mollie.js')
            const { subscriptionIdInMollie, customerId, dataToUpdate } = data
            await updateMollieSubscription(subscriptionIdInMollie, customerId, dataToUpdate)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.sendMonthlyInvoiceSecondGen = onRequest(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processMontlyPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processMontlyPaymentStatus(id, res)
    }
)

exports.sendMonthlyInvoice = onRequest(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { processMontlyPaymentStatus } = require('./Payment/WebhookHandlers')
        const { id } = req.body
        await processMontlyPaymentStatus(id, res)
    }
)

// "At 00:00 on day-of-month 1."
exports.resetUserFreePlanSecondGen = onSchedule(
    {
        schedule: '0 0 1 * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '1GiB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { resetWarningsAndQuotas } = require('./Payment/QuotaWarnings')
        await resetWarningsAndQuotas(admin)
        log('Server Time', { hour: new Date().getHours(), minute: new Date().getMinutes() })
    }
)

// "Every Day at 00:00."
exports.autoCancelSubscriptionsSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '512MiB',
    },
    async event => {
        const { autoCancelSubscription } = require('./Payment/CancelSubscriptions')
        await autoCancelSubscription()
    }
)

//ALGOLIA

exports.indexProjectsRecordsInAlgoliaSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { indexProjectsRecordsInAlgolia } = require('./AlgoliaGlobalSearchHelper')
            const { userId } = data
            await indexProjectsRecordsInAlgolia(userId)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.proccessAlgoliaRecordsWhenUnlockGoalSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { proccessAlgoliaRecordsWhenUnlockGoal } = require('./AlgoliaGlobalSearchHelper')
            const { projectId, goalId } = data
            await proccessAlgoliaRecordsWhenUnlockGoal(projectId, goalId, admin)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// "Every Day at 00:00."
exports.checkAndRemoveInactiveObjectsFromAlgoliaSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '2GiB',
    },
    async event => {
        const { checkAndRemoveInactiveObjectsFromAlgolia } = require('./AlgoliaGlobalSearchHelper')
        await checkAndRemoveInactiveObjectsFromAlgolia()
        return null
    }
)

// "Every Day at 00:00."
exports.checkAndRemoveProjectsWithoutActivityFromAlgoliaSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '512MiB',
    },
    async event => {
        const { checkAndRemoveProjectsWithoutActivityFromAlgolia } = require('./AlgoliaGlobalSearchHelper')
        await checkAndRemoveProjectsWithoutActivityFromAlgolia()
    }
)

exports.onStartIndexingAlgoliaTasksSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/tasks`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startTasksIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startTasksIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaGoalsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/goals`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startGoalsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startGoalsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaNotesSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/notes`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startNotesIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startNotesIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaContactsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/contacts`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startContactsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startContactsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaAssistantsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/assistants`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startAssistantsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startAssistantsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaChatsSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/chats`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startChatsIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startChatsIndextion(projectId, activeFullSearchDate)
    }
)

exports.onStartIndexingAlgoliaUsersSecondGen = onDocumentCreated(
    {
        document: `algoliaIndexation/{projectId}/objectTypes/users`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { startUsersIndextion } = require('./searchHelper')
        const { projectId } = event.params
        const { activeFullSearchDate } = event.data.data()
        await startUsersIndextion(projectId, activeFullSearchDate)
    }
)

exports.onEndIndexingAlgoliaFullSearchSecondGen = onDocumentUpdated(
    {
        document: `algoliaFullSearchIndexation/{projectId}`,
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { checkAlgoliaFullSearchIndeaxtion } = require('./searchHelper')
        const { projectId } = event.params
        const fullSearchIndeaxtion = event.data.after.data()
        await checkAlgoliaFullSearchIndeaxtion(projectId, fullSearchIndeaxtion)
    }
)

//TEMPLATE AND COMMUNITY PROJECTS

exports.sendUserJoinsToGuideEmailSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const SendInBlueManager = require('./SendInBlueManager')
            const { inProductionEnvironment } = require('./Utils/HelperFunctionsCloud.js')

            const { usersToReceiveEmailIds, guideId, newUserId } = data
            const inProduction = inProductionEnvironment()

            return inProduction
                ? await SendInBlueManager.sendNewUserJoinToGuideEmail(admin, guideId, newUserId, usersToReceiveEmailIds)
                : null
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.copyTemplateObjectsSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { copyDataFromTemplateToGuide } = require('./Templates/TemplatesHelper')

            const {
                templateId,
                creatorId,
                guideId,
                userId,
                userName,
                userPhotoUrl,
                dateMiddleOfDay,
                dateNow,
                unlockedTemplate,
                isNewGuide,
                globalAssistantIds,
            } = data
            await copyDataFromTemplateToGuide(
                admin,
                admin,
                templateId,
                creatorId,
                guideId,
                userId,
                userName,
                userPhotoUrl,
                dateMiddleOfDay,
                dateNow,
                unlockedTemplate,
                isNewGuide,
                globalAssistantIds
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// "Every Day at 00:00."
exports.updateTemplatesObjectsDatesSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '512MiB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { updateTemplatesObjectsDates } = require('./Templates/TemplatesObjectDates')
        await updateTemplatesObjectsDates(admin)
    }
)

//NOTES HISTORY

// "Every Day at 00:00."
exports.checkIfEditedNotesNeedBeCopiedSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '2GiB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { processEditedNotesForRevisionHistory } = require('./NotesRevisionHistory')
        await processEditedNotesForRevisionHistory(admin)
    }
)

// "Every Day at 00:00."
exports.checkIfDeletedNotesNeedBeCleanedSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '2GiB',
    },
    async event => {
        const admin = require('firebase-admin')
        const { processRevisionHistoryForDeletedNotes } = require('./NotesRevisionHistory')
        await processRevisionHistoryForDeletedNotes(admin)
    }
)

//GOLD

exports.earnGoldSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { earnGold } = require('./Gold/goldHelper')
            const { projectId, userId, gold, slimDate, timestamp, dayDate } = data
            await earnGold(projectId, userId, gold, slimDate, timestamp, dayDate)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// "Every Day at 00:00."
exports.resetDailyGoldLimitSecondGen = onSchedule(
    {
        schedule: '0 0 * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '512MiB',
    },
    async event => {
        const { resetDailyGoldLimit } = require('./Gold/goldHelper')
        resetDailyGoldLimit()
    }
)

// "At 00:00 on day-of-month 1."
exports.giveMonthlyGoldToAllUsersSecondGen = onSchedule(
    {
        schedule: '0 0 1 * *',
        timeZone: 'Europe/Berlin',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '4GiB',
    },
    async context => {
        const { addMonthlyGoldToAllUsers } = require('./Gold/goldHelper')
        await addMonthlyGoldToAllUsers()
    }
)

//AI ASSISTANTS

// Pre-load module at top level to avoid repeated require overhead
const { askToOpenAIBot } = require('./Assistant/assistantNormalTalk_optimized')

exports.askToBotSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB', // Increased for better performance
        minInstances: 1, // Keep 2 instances warm to avoid cold starts
        maxInstances: 100, // Allow scaling when needed
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const functionEntryTime = Date.now()
        const { data, auth } = request

        console.log('🎯 [TIMING] askToBotSecondGen ENTRY POINT', {
            timestamp: new Date().toISOString(),
            entryTime: functionEntryTime,
            hasAuth: !!auth,
            dataKeys: Object.keys(data || {}),
            userId: data?.userId,
            messageId: data?.messageId,
            projectId: data?.projectId,
            objectType: data?.objectType,
            objectId: data?.objectId,
            assistantId: data?.assistantId,
        })

        if (auth) {
            console.log(`📊 [TIMING] Module require (pre-loaded): 0ms`)
            const {
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                isPublicFor,
                language,
                assistantId,
                followerIds,
            } = data
            console.log('📊 [TIMING] Function setup complete, calling askToOpenAIBot:', {
                setupTime: `${Date.now() - functionEntryTime}ms`,
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                assistantId,
            })

            const askToOpenAIBotStart = Date.now()
            const result = await askToOpenAIBot(
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                isPublicFor,
                language,
                assistantId,
                followerIds,
                functionEntryTime // Pass entry time for time-to-first-token tracking
            )

            const totalFunctionTime = Date.now() - functionEntryTime
            console.log('🎯 [TIMING] askToBotSecondGen COMPLETE', {
                totalFunctionTime: `${totalFunctionTime}ms`,
                setupTime: `${askToOpenAIBotStart - functionEntryTime}ms`,
                askToOpenAIBotTime: `${Date.now() - askToOpenAIBotStart}ms`,
                entryTime: functionEntryTime,
                completionTime: Date.now(),
            })

            return result
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotWelcomeMessageSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generateBotWelcomeMessageForGuide } = require('./Assistant/assistantWelcomeMessageForGuide')
            const { projectId, objectId, userIdsToNotify, guideName, language, assistantId } = data
            return await generateBotWelcomeMessageForGuide(
                projectId,
                objectId,
                userIdsToNotify,
                guideName,
                language,
                assistantId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotWelcomeMessageToUserSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generateBotWelcomeMessageForGuideUser } = require('./Assistant/assistantWelcomeMessageForGuideUser')
            const {
                projectId,
                objectId,
                userIdsToNotify,
                guideName,
                language,
                userId,
                userName,
                taskListUrlOrigin,
                assistantId,
            } = data
            return await generateBotWelcomeMessageForGuideUser(
                projectId,
                objectId,
                userIdsToNotify,
                guideName,
                language,
                userId,
                userName,
                taskListUrlOrigin,
                assistantId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generatePreConfigTaskResultSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB', // Increased for better performance
        minInstances: 1, // Keep 1 instance warm
        maxInstances: 100,
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const functionEntryTime = Date.now()
        const { data, auth } = request

        console.log('🎯 [TIMING] generatePreConfigTaskResultSecondGen ENTRY POINT', {
            timestamp: new Date().toISOString(),
            entryTime: functionEntryTime,
            hasAuth: !!auth,
            userId: data?.userId,
            projectId: data?.projectId,
            taskId: data?.taskId,
            assistantId: data?.assistantId,
            promptLength: data?.prompt?.length,
        })
        console.log('🚀 generatePreConfigTaskResultSecondGen called in emulator!')

        if (auth) {
            const { generatePreConfigTaskResult } = require('./Assistant/assistantPreConfigTaskTopic')
            const {
                userId,
                projectId,
                taskId,
                userIdsToNotify,
                isPublicFor,
                assistantId,
                prompt,
                language,
                aiSettings,
                taskMetadata,
            } = data
            const result = await generatePreConfigTaskResult(
                userId,
                projectId,
                taskId,
                userIdsToNotify,
                isPublicFor,
                assistantId,
                prompt,
                language,
                aiSettings,
                taskMetadata,
                functionEntryTime // Pass entry time for time-to-first-token tracking
            )

            const totalFunctionTime = Date.now() - functionEntryTime
            console.log('🎯 [TIMING] generatePreConfigTaskResultSecondGen COMPLETE', {
                totalFunctionTime: `${totalFunctionTime}ms`,
                entryTime: functionEntryTime,
                completionTime: Date.now(),
            })

            return result
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotAdvaiceSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB', // Increased for better performance
        minInstances: 1, // Keep 1 instance warm
        maxInstances: 100,
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { generateBotAdvaiceForTopic } = require('./Assistant/assistantAdvaiceForTopic')
            const {
                projectId,
                objectId,
                objectType,
                userIdsToNotify,
                topicName,
                language,
                isPublicFor,
                assistantId,
                followerIds,
                userId,
            } = data
            return await generateBotAdvaiceForTopic(
                projectId,
                objectId,
                objectType,
                userIdsToNotify,
                topicName,
                language,
                isPublicFor,
                assistantId,
                followerIds,
                userId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.generateBotDailyTopicCommentSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { generateBotDailyTopicFirstComment } = require('./Assistant/assistantDailyTopic')

            const {
                userId,
                startDate,
                endDate,
                todayDate,
                lastSessionDate,
                objectId,
                userIdsToNotify,
                language,
                assistantId,
            } = data

            return await generateBotDailyTopicFirstComment(
                admin,
                userId,
                startDate,
                endDate,
                todayDate,
                lastSessionDate,
                objectId,
                userIdsToNotify,
                language,
                assistantId
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

//VIDEOS

exports.convertVideosSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '4GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { convertVideos } = require('./videosHelper')
            return await convertVideos(admin, data)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

// Delete video recordings after two weeks. run Sundays at 00:05
exports.removeOldVideosSecondGen = onSchedule(
    {
        schedule: '5 0 * * 0',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const { removeOldRecordings } = require('./videosHelper')
        await removeOldRecordings(admin)
    }
)

//PROJECTS

exports.onCreateProjectSecondGen = onDocumentCreated(
    {
        document: `/projects/{projectId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateProject } = require('./Projects/onCreateProjectFunctions')
        const project = event.data.data()
        await onCreateProject(project)
    }
)

exports.onUpdateProjectSecondGen = onDocumentUpdated(
    {
        document: 'projects/{projectId}',
        timeoutSeconds: 540,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateProject } = require('./Projects/onUpdateProjectFunctions')
        const { mapProjectData } = require('./Utils/MapDataFuncions')

        const projectId = event.params.projectId
        const oldProject = mapProjectData(projectId, event.data.before.data())
        const newProject = mapProjectData(projectId, event.data.after.data())
        await onUpdateProject(projectId, oldProject, newProject)
    }
)

exports.onDeleteProjectSecondGen = onDocumentDeleted(
    {
        document: 'projects/{projectId}',
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteProject } = require('./Projects/onDeleteProjectFunctions')
        const { projectId } = event.params
        await onDeleteProject(projectId)
    }
)

//USERS

exports.onCreateUserSecondGen = onDocumentCreated(
    {
        document: `/users/{userId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateUser } = require('./Users/onCreateUserFunctions')
        const { userId } = event.params
        const user = { ...event.data.data(), uid: userId }
        await onCreateUser(user)
    }
)

exports.onUpdateUserSecondGen = onDocumentUpdated(
    {
        document: 'users/{userId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateUser } = require('./Users/onUpdateUserFunctions')
        const { userId } = event.params
        await onUpdateUser(userId, event.data)
    }
)

exports.onDeleteUserSecondGen = onDocumentDeleted(
    {
        document: 'users/{userId}',
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteUser } = require('./Users/onDeleteUserFunctions')
        const { userId } = event.params
        const user = { ...event.data.data(), uid: userId }
        await onDeleteUser(user)
    }
)

//CHATS

exports.onCreateChatSecondGen = onDocumentCreated(
    {
        document: `chatObjects/{projectId}/chats/{chatId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateChat } = require('./Chats/onCreateChatFunctions')
        const { projectId, chatId } = event.params
        const chat = { ...event.data.data(), id: chatId }
        await onCreateChat(projectId, chat)
    }
)

exports.onUpdateChatSecondGen = onDocumentUpdated(
    {
        document: 'chatObjects/{projectId}/chats/{chatId}',
        timeoutSeconds: 540,
        memory: '256MB',
        minInstances: 1,
        maxInstances: 100,
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateChat } = require('./Chats/onUpdateChatFunctions')
        const { projectId, chatId } = event.params
        await onUpdateChat(projectId, chatId, event.data)
    }
)

exports.onDeleteChatSecondGen = onDocumentDeleted(
    {
        document: 'chatObjects/{projectId}/chats/{chatId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteChat } = require('./Chats/onDeleteChatFunctions')
        const { projectId, chatId } = event.params
        const chat = { ...event.data.data(), id: chatId }
        await onDeleteChat(projectId, chat)
    }
)

//TASKS

exports.onCreateTaskSecondGen = onDocumentCreated(
    {
        document: `items/{projectId}/tasks/{taskId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateTask } = require('./Tasks/onCreateTaskFunctions')
        const { projectId, taskId } = event.params
        const task = { ...event.data.data(), id: taskId }
        await onCreateTask(task, projectId)
    }
)

exports.onUpdateTaskSecondGen = onDocumentUpdated(
    {
        document: 'items/{projectId}/tasks/{taskId}',
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateTask } = require('./Tasks/onUpdateTaskFunctions')
        const { projectId, taskId } = event.params
        await onUpdateTask(taskId, projectId, event.data)
    }
)

exports.onDeleteTaskSecondGen = onDocumentDeleted(
    {
        document: 'items/{projectId}/tasks/{taskId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteTask } = require('./Tasks/onDeleteTaskFunctions')
        const { projectId, taskId } = event.params
        const task = { ...event.data.data(), id: taskId }
        await onDeleteTask(projectId, task)
    }
)

//ASSISTANTS

exports.onCreateAssistantSecondGen = onDocumentCreated(
    {
        document: `assistants/{projectId}/items/{assistantId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateAssistant } = require('./Assistants/onCreateAssistantFunctions')
        const { projectId, assistantId } = event.params
        const assistant = { ...event.data.data(), uid: assistantId }
        await onCreateAssistant(projectId, assistant)
    }
)

exports.onUpdateAssistantSecondGen = onDocumentUpdated(
    {
        document: 'assistants/{projectId}/items/{assistantId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateAssistant } = require('./Assistants/onUpdateAssistantFunctions.js')
        const { projectId, assistantId } = event.params
        await onUpdateAssistant(projectId, assistantId, event.data)
    }
)

exports.onDeleteAssistantSecondGen = onDocumentDeleted(
    {
        document: 'assistants/{projectId}/items/{assistantId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteAssistant } = require('./Assistants/onDeleteAssistantFunctions.js')
        const { projectId, assistantId } = event.params
        const assistant = { ...event.data.data(), uid: assistantId }
        await onDeleteAssistant(projectId, assistant)
    }
)

// ASSISTANT TASKS

exports.onCreateAssistantTaskSecondGen = onDocumentCreated(
    {
        document: `assistantTasks/{projectId}/{assistantId}/{assistantTaskId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateAssistantTask } = require('./AssistantTasks/onCreateAssistantTaskFunctions')
        const { projectId, assistantId, assistantTaskId } = event.params
        const assistantTask = { ...event.data.data(), id: assistantTaskId }
        await onCreateAssistantTask(projectId, assistantId, assistantTask)
    }
)

exports.onUpdateAssistantTaskSecondGen = onDocumentUpdated(
    {
        document: `assistantTasks/{projectId}/{assistantId}/{assistantTaskId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateAssistantTask } = require('./AssistantTasks/onUpdateAssistantTaskFunctions.js')
        const { projectId, assistantId, assistantTaskId } = event.params
        await onUpdateAssistantTask(projectId, assistantId, assistantTaskId, event.data)
    }
)

exports.onDeleteAssistantTaskSecondGen = onDocumentDeleted(
    {
        document: `assistantTasks/{projectId}/{assistantId}/{assistantTaskId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteAssistantTask } = require('./AssistantTasks/onDeleteAssistantTaskFunctions.js')
        const { projectId, assistantId, assistantTaskId } = event.params
        await onDeleteAssistantTask(projectId, assistantId, assistantTaskId)
    }
)

//CONTACTS

exports.onCreateContactSecondGen = onDocumentCreated(
    {
        document: `projectsContacts/{projectId}/contacts/{contactId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateContact } = require('./Contacts/onCreateContactFunctions')
        const { projectId, contactId } = event.params
        const contact = { ...event.data.data(), uid: contactId }
        await onCreateContact(projectId, contact)
    }
)

exports.onUpdateContactSecondGen = onDocumentUpdated(
    {
        document: 'projectsContacts/{projectId}/contacts/{contactId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateContact } = require('./Contacts/onUpdateContactFunctions')
        const { projectId, contactId } = event.params
        await onUpdateContact(projectId, contactId, event.data)
    }
)

exports.onDeleteContactSecondGen = onDocumentDeleted(
    {
        document: 'projectsContacts/{projectId}/contacts/{contactId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteContact } = require('./Contacts/onDeleteContactFunctions')
        const { projectId, contactId } = event.params
        const contact = { ...event.data.data(), uid: contactId }
        await onDeleteContact(projectId, contact)
    }
)

//GOALS

exports.onCreateGoalSecondGen = onDocumentCreated(
    {
        document: `goals/{projectId}/items/{goalId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateGoal } = require('./Goals/onCreateGoalFunctions')
        const { projectId, goalId } = event.params
        const goal = { ...event.data.data(), id: goalId }
        await onCreateGoal(projectId, goal)
    }
)

exports.onUpdateGoalSecondGen = onDocumentUpdated(
    {
        document: 'goals/{projectId}/items/{goalId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateGoal } = require('./Goals/onUpdateGoalFunctions')
        const { projectId, goalId } = event.params
        await onUpdateGoal(projectId, goalId, event.data)
    }
)

exports.onDeleteGoalSecondGen = onDocumentDeleted(
    {
        document: 'goals/{projectId}/items/{goalId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteGoal } = require('./Goals/onDeleteGoalFunctions')
        const { projectId, goalId } = event.params
        const goal = { ...event.data.data(), id: goalId }
        await onDeleteGoal(projectId, goal)
    }
)

//SKILLS

exports.onDeleteSkillSecondGen = onDocumentDeleted(
    {
        document: 'skills/{projectId}/items/{skillId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteSkill } = require('./Skills/onDeleteSkillFunctions')
        const { projectId, skillId } = event.params
        const skill = { ...event.data.data(), id: skillId }
        await onDeleteSkill(projectId, skill)
    }
)

//NOTES

exports.onCreateNoteSecondGen = onDocumentCreated(
    {
        document: `noteItems/{projectId}/notes/{noteId}`,
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onCreateNote } = require('./Notes/onCreateNoteFunctions')
        const { projectId, noteId } = event.params
        const note = { ...event.data.data(), id: noteId }
        await onCreateNote(projectId, note)
    }
)

exports.onUpdateNoteSecondGen = onDocumentUpdated(
    {
        document: 'noteItems/{projectId}/notes/{noteId}',
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { onUpdateNote } = require('./Notes/onUpdateNoteFunctions')
        const { projectId, noteId } = event.params
        await onUpdateNote(projectId, noteId, event.data)
    }
)

exports.onDeleteNoteSecondGen = onDocumentDeleted(
    {
        document: 'noteItems/{projectId}/notes/{noteId}',
        timeoutSeconds: 540,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { onDeleteNote } = require('./Notes/onDeleteNoteFunctions')
        const { projectId, noteId } = event.params
        const note = { ...event.data.data(), id: noteId }
        await onDeleteNote(projectId, note)
    }
)

//OTHERS yes

exports.deleteUserSecondGen = onCall(
    {
        timeoutSeconds: 30,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            try {
                const { userId } = data
                await admin.auth().deleteUser(userId)
                console.log('Successfully deleted user')
            } catch (e) {
                console.log('Error deleting user:', e.message)
            }
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.sendPushNotificationSecondGen = onCall(
    {
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { processPushNotifications } = require('./PushNotifications/pushNotifications')
            return await processPushNotifications([data])
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.onRemoveWorkstreamSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { onRemoveWorkstream } = require('./Workstreams/WorkstreamHelper')
            const { projectId, streamId } = data
            return await onRemoveWorkstream(admin, projectId, streamId)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.addCalendarEventsToTasksSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MiB',
        // minInstances: 0, //inProduction ? 5 : 1,
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addCalendarEvents } = require('./GoogleCalendarTasks/calendarTasks')
            const { events, projectId, uid, email } = data
            await addCalendarEvents(events, projectId, uid, email)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.removeOldCalendarTasksSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { removeCalendarTasks } = require('./GoogleCalendarTasks/calendarTasks')
            const { uid, dateFormated, events, removeFromAllDates } = data
            await removeCalendarTasks(uid, dateFormated, events, removeFromAllDates).catch(console.error)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.onCopyProjectSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const admin = require('firebase-admin')
            const { onCopyProject } = require('./CopyProject/CopyProjectHelper')
            const { projectId, user, options } = data
            return await onCopyProject(admin, projectId, user, options)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.createApiEmailTasksSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { addUnreadMailsTask } = require('./apis/EmailIntegration')
            const { projectId, date, uid, unreadMails, email } = data
            await addUnreadMailsTask(projectId, uid, date, unreadMails, email)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.increaseVersionSecondGen = onRequest(
    {
        region: 'europe-west1',
    },
    async (req, res) => {
        const admin = require('firebase-admin')
        const ref = admin.firestore().doc('info/version')
        const version = (await ref.get()).data() ?? {
            major: 0,
            minor: 1,
            patch: 0,
        }
        version.minor++
        ref.set(version)
        res.status(200).send(`Version increased to ${version.major}.${version.minor}.${version.patch}`)
    }
)

exports.sendEmailFeedNotificationSecondGen = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const SendInBlueManager = require('./SendInBlueManager')
        const { inProductionEnvironment } = require('./Utils/HelperFunctionsCloud.js')

        const inProduction = inProductionEnvironment()
        return inProduction ? await SendInBlueManager.sendFeedNotifications(admin) : null
    }
)

exports.sendEmailChatNotificationSecondGen = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const SendInBlueManager = require('./SendInBlueManager')
        const { inProductionEnvironment } = require('./Utils/HelperFunctionsCloud.js')

        const inProduction = inProductionEnvironment()
        return inProduction ? await SendInBlueManager.sendChatNotifications(admin) : null
    }
)

exports.sendChatPushNotificationsSecondGen = onSchedule(
    {
        schedule: 'every 1 minutes',
        region: 'europe-west1',
    },
    async context => {
        const { processChatPushNotifications } = require('./PushNotifications/pushNotifications')
        return await processChatPushNotifications()
    }
)

exports.sendWhatsAppNotificationsSecondGen = onSchedule(
    {
        schedule: 'every 1 minutes',
        region: 'europe-west1',
    },
    async context => {
        const { processWhatsAppNotifications } = require('./WhatsApp/whatsAppNotifications')
        return await processWhatsAppNotifications()
    }
)

exports.checkTaskAlertsSecondGen = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
        timeoutSeconds: 300,
        memory: '512MiB',
    },
    async context => {
        const { checkAndTriggerTaskAlerts } = require('./Tasks/taskAlertsCloud')
        return await checkAndTriggerTaskAlerts()
    }
)

// "Every Year at 1 of january."
exports.resetInvoiceNumbersSecondGen = onSchedule(
    {
        schedule: '0 0 1 1 *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 540,
        memory: '512MiB',
    },
    async event => {
        const { resetInvoiceNumbers } = require('./Utils/invoiceNumbers.js')
        await resetInvoiceNumbers()
    }
)

exports.scheduledFirestoreBackupSecondGen = onSchedule(
    {
        schedule: 'every 24 hours',
        region: 'europe-west1',
    },
    event => {
        const { scheduledFirestoreBackup } = require('./Utils/firestoreBackup.js')
        const firebaseProjectId = process.env.GCLOUD_PROJECT
        return scheduledFirestoreBackup(firebaseProjectId)
    }
)

exports.checkForDemoteStickyNotesSecondGen = onSchedule(
    {
        schedule: 'every 30 minutes',
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async event => {
        const admin = require('firebase-admin')
        const { checkStickyNotes } = require('./StickyNotesHelper')
        await checkStickyNotes(admin)
    }
)

exports.onCreateProjectInvitationSecondGen = onDocumentCreated(
    {
        document: `/projectsInvitation/{projectId}/invitations/{invitationId}`,
        region: 'europe-west1',
    },
    async event => {
        const { onCreateProjectInvitation } = require('./Utils/projectInvitation.js')
        const invitation = event.data.data()
        await onCreateProjectInvitation(invitation, event.params.projectId)
    }
)

//FOR CHECK IF STILL ARE USED

exports.sanityCheckSecondGen = onRequest(
    {
        region: 'europe-west1',
    },
    async (req, res) => {
        const { sanityCheck } = require('./Utils/sanityCheckHelper.js')
        await sanityCheck(res)
    }
)

exports.getLinkPreviewDataSecondGen = onRequest(
    {
        timeoutSeconds: 540,
        memory: '512MiB',
        // minInstances: 0, //inProduction ? 5 : 1,
        region: 'europe-west1',
    },
    async (req, res) => {
        const admin = require('firebase-admin')
        const { processUrl } = require('./URLPreview/URLPreview')
        const { pathname } = req.body.data
        const previewData = await processUrl(admin, pathname)
        res.status(200).send(previewData)
    }
)

// RECURRING ASSISTANT TASKS
exports.checkRecurringAssistantTasks = onSchedule(
    {
        schedule: '*/5 * * * *', // Run every 5 minutes
        timeoutSeconds: 900, // 15 minutes - increased for parallel batch execution
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { checkAndExecuteRecurringTasks } = require('./Assistant/assistantRecurringTasks')
        await checkAndExecuteRecurringTasks()
    }
)

// MCP OAUTH CALLBACK
exports.mcpOAuthCallback = onRequest(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type'],
            credentials: false,
        },
    },
    async (req, res) => {
        const { mcpOAuthCallback } = require('./mcpOAuthCallback.js')
        await mcpOAuthCallback(req, res)
    }
)

// MIGRATION: Backfill lastLogin field for all users
exports.backfillLastLogin = onRequest(
    {
        timeoutSeconds: 540, // 9 minutes - for large user bases
        memory: '512MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        try {
            console.log('🚀 Backfill lastLogin migration triggered via HTTP')

            const { backfillLastLogin } = require('./Migrations/backfillLastLogin')
            const result = await backfillLastLogin()

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Migration completed successfully',
                    ...result,
                })
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Migration failed',
                    ...result,
                })
            }
        } catch (error) {
            console.error('❌ Migration endpoint error:', error)
            res.status(500).json({
                success: false,
                error: error.message,
                stack: error.stack,
            })
        }
    }
)

// WEBHOOK CALLBACK FOR ASSISTANT TASKS
exports.webhookCallbackForAssistantTasks = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: false,
        },
    },
    async (req, res) => {
        const { processWebhookCallback } = require('./Assistant/webhookCallbackHandler')
        await processWebhookCallback(req, res)
    }
)

// EXECUTE WEBHOOK FOR USER MESSAGE - Triggered when user sends message in webhook task
exports.executeWebhookForMessage = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async request => {
        const { executeWebhookForUserMessage } = require('./Assistant/webhookForMessage')
        return await executeWebhookForUserMessage(request.data)
    }
)

// CLEANUP EXPIRED WEBHOOK TASKS - Run every 10 minutes
exports.cleanupExpiredWebhookTasks = onSchedule(
    {
        schedule: '*/10 * * * *', // Every 10 minutes
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { cleanupExpiredWebhooks } = require('./Assistant/webhookCallbackHandler')
        await cleanupExpiredWebhooks()
    }
)

// GOOGLE OAUTH - Server-side OAuth for Calendar and Gmail integration

// Initiate Google OAuth flow
exports.googleOAuthInitiate = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        const { initiateOAuth } = require('./GoogleOAuth/googleOAuthHandler')
        const { projectId } = data
        const userId = auth.uid

        try {
            const authUrl = await initiateOAuth(userId, projectId)
            return { authUrl }
        } catch (error) {
            console.error('Error initiating Google OAuth:', error)
            throw new HttpsError('internal', `Failed to initiate OAuth: ${error.message}`)
        }
    }
)

// OAuth callback endpoint - handles redirect from Google
exports.googleOAuthCallback = onRequest(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'OPTIONS'],
            allowedHeaders: ['Content-Type'],
            credentials: false,
        },
    },
    async (req, res) => {
        const { code, state, error } = req.query

        if (error) {
            // User denied access or other OAuth error
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Failed</title>
                    <style>
                        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
                        .message { text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        .error { color: #d32f2f; }
                    </style>
                </head>
                <body>
                    <div class="message">
                        <h2 class="error">Authentication Failed</h2>
                        <p>The authentication was cancelled or failed.</p>
                        <p>This window will close automatically...</p>
                    </div>
                    <script>
                        // Notify parent window of error
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'oauth_error',
                                error: '${encodeURIComponent(error)}'
                            }, '*');
                        }
                        // Close window after a short delay
                        setTimeout(() => window.close(), 2000);
                    </script>
                </body>
                </html>
            `)
            return
        }

        if (!code || !state) {
            res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Error</title></head>
                <body>
                    <h2>Error</h2>
                    <p>Missing code or state parameter</p>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ type: 'oauth_error', error: 'Missing parameters' }, '*');
                        }
                        setTimeout(() => window.close(), 2000);
                    </script>
                </body>
                </html>
            `)
            return
        }

        try {
            const { handleOAuthCallback } = require('./GoogleOAuth/googleOAuthHandler')
            const result = await handleOAuthCallback(code, state)

            // Return HTML page that notifies parent and closes
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Successful</title>
                    <style>
                        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
                        .message { text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        .success { color: #4caf50; }
                        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #4caf50; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <div class="message">
                        <h2 class="success">✓ Authentication Successful</h2>
                        <p>Your Google account has been connected!</p>
                        <div class="spinner"></div>
                        <p>Closing window...</p>
                    </div>
                    <script>
                        // Notify parent window of success
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'oauth_success',
                                projectId: '${result.projectId}',
                                email: '${result.email}'
                            }, '*');
                        }
                        // Close window after a short delay
                        setTimeout(() => window.close(), 1500);
                    </script>
                </body>
                </html>
            `)
        } catch (error) {
            console.error('OAuth callback error:', error)
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Error</title>
                    <style>
                        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
                        .message { text-align: center; padding: 40px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        .error { color: #d32f2f; }
                    </style>
                </head>
                <body>
                    <div class="message">
                        <h2 class="error">Authentication Error</h2>
                        <p>An error occurred during authentication.</p>
                        <p>${error.message}</p>
                        <p>This window will close automatically...</p>
                    </div>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'oauth_error',
                                error: '${encodeURIComponent(error.message)}'
                            }, '*');
                        }
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
                </html>
            `)
        }
    }
)

// Get a fresh access token for the authenticated user
exports.googleOAuthGetToken = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        try {
            const { getAccessToken } = require('./GoogleOAuth/googleOAuthHandler')
            const accessToken = await getAccessToken(auth.uid)
            return { accessToken }
        } catch (error) {
            console.error('Error getting access token:', error)
            if (error.message.includes('not authenticated')) {
                throw new HttpsError('not-found', 'User not authenticated with Google')
            }
            throw new HttpsError('internal', `Failed to get access token: ${error.message}`)
        }
    }
)

// Revoke Google OAuth access
exports.googleOAuthRevoke = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        try {
            const { revokeAccess } = require('./GoogleOAuth/googleOAuthHandler')
            const { projectId } = data
            const result = await revokeAccess(auth.uid, projectId)
            return result
        } catch (error) {
            console.error('Error revoking access:', error)
            throw new HttpsError('internal', `Failed to revoke access: ${error.message}`)
        }
    }
)

// Check if user has valid Google credentials
exports.googleOAuthCheckCredentials = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        try {
            const { hasValidCredentials } = require('./GoogleOAuth/googleOAuthHandler')
            const hasCredentials = await hasValidCredentials(auth.uid)
            return { hasCredentials }
        } catch (error) {
            console.error('Error checking credentials:', error)
            throw new HttpsError('internal', `Failed to check credentials: ${error.message}`)
        }
    }
)
