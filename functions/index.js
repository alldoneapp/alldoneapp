'use strict'
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onTaskDispatched } = require('firebase-functions/v2/tasks')
const { log } = require('firebase-functions/logger')
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore')

const admin = require('firebase-admin')
const firebaseConfig = require('./firebaseConfig.js')
const { PLAN_STATUS_PREMIUM } = require('./Payment/premiumHelper')
const { assertObjectAccess } = require('./shared/privacyAccess')
const { VM_JOB_QUEUE_RATE_LIMITS, VM_JOB_WORKER_TIMEOUT_SECONDS } = require('./Assistant/vmJobConfig')

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

function getAccessibleProjectIdsFromUserData(userData = {}) {
    const allIds = new Set()
    ;['projectIds', 'guideProjectIds', 'templateProjectIds', 'archivedProjectIds'].forEach(key => {
        const ids = userData?.[key]
        if (!Array.isArray(ids)) return
        ids.forEach(id => {
            if (typeof id === 'string' && id.trim()) allIds.add(id.trim())
        })
    })
    return Array.from(allIds)
}

async function assertProjectAccess(userId, projectId) {
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (!userDoc.exists) {
        throw new HttpsError('permission-denied', 'User not found')
    }

    const accessibleProjectIds = getAccessibleProjectIdsFromUserData(userDoc.data() || {})
    if (!accessibleProjectIds.includes(projectId)) {
        throw new HttpsError('permission-denied', 'No access to project')
    }

    return userDoc.data() || {}
}

// Access check for account-level connection ids (email_… / calendar_…): the connection
// must belong to the caller. Returns { userData, connection }.
async function assertConnectionAccess(userId, connectionId) {
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (!userDoc.exists) {
        throw new HttpsError('permission-denied', 'User not found')
    }

    const userData = userDoc.data() || {}
    const { getConnection } = require('./Integrations/providerConnections')
    const service = String(connectionId || '').startsWith('calendar_') ? 'calendar' : 'email'
    const connection = getConnection(userData, service, connectionId)
    if (!connection) {
        throw new HttpsError('permission-denied', 'No access to this connection')
    }

    return { userData, connection }
}

// Many callables accept either a legacy projectId or an account-level connectionId.
// Resolves the working key, runs the matching access check, and returns everything.
async function assertEmailLineAccess(userId, data = {}) {
    const connectionId = typeof data.connectionId === 'string' && data.connectionId.trim() ? data.connectionId : null
    const projectId = typeof data.projectId === 'string' && data.projectId.trim() ? data.projectId : null
    if (!connectionId && !projectId) {
        throw new HttpsError('invalid-argument', 'projectId or connectionId is required')
    }
    if (connectionId) {
        const { userData, connection } = await assertConnectionAccess(userId, connectionId)
        return { key: connectionId, userData, connection }
    }
    const userData = await assertProjectAccess(userId, projectId)
    return { key: projectId, userData, connection: null }
}

async function assertAdministrator(userId) {
    const administratorRoleDoc = await admin
        .firestore()
        .doc('roles/administrator')
        .get()
        .catch(() => null)

    const isAdministrator = administratorRoleDoc?.exists && administratorRoleDoc.data()?.userId === userId

    if (!isAdministrator) {
        throw new HttpsError('permission-denied', 'Administrator access required')
    }

    return true
}

function assertPremiumFeatureAccess(userData, featureName = 'This feature') {
    if (userData?.premium?.status !== PLAN_STATUS_PREMIUM) {
        throw new HttpsError('permission-denied', `${featureName} is available for premium users only`)
    }
}

async function assertAssistantProjectAccess(userId, projectId, assistantId) {
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    if (!userDoc.exists) throw new HttpsError('permission-denied', 'User not found')
    const userData = userDoc.data() || {}
    const accessibleProjectIds = getAccessibleProjectIdsFromUserData(userData)

    if (projectId !== 'globalProject') {
        if (!accessibleProjectIds.includes(projectId)) {
            throw new HttpsError('permission-denied', 'No access to project')
        }
        return
    }

    const assistantDoc = await admin.firestore().doc(`assistants/globalProject/items/${assistantId}`).get()
    if (!assistantDoc.exists) throw new HttpsError('not-found', 'Assistant not found')

    const administratorRoleDoc = await admin
        .firestore()
        .doc('roles/administrator')
        .get()
        .catch(() => null)
    const isAdministrator = administratorRoleDoc?.exists && administratorRoleDoc.data()?.userId === userId
    if (isAdministrator) return

    let hasAccessToGlobalAssistant = false
    for (let i = 0; i < accessibleProjectIds.length; i++) {
        const projectDoc = await admin.firestore().doc(`projects/${accessibleProjectIds[i]}`).get()
        if (!projectDoc.exists) continue
        const globalAssistantIds = Array.isArray(projectDoc.data()?.globalAssistantIds)
            ? projectDoc.data().globalAssistantIds
            : []
        if (globalAssistantIds.includes(assistantId)) {
            hasAccessToGlobalAssistant = true
            break
        }
    }

    if (!hasAccessToGlobalAssistant) {
        throw new HttpsError('permission-denied', 'No access to global assistant')
    }
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

exports.connectGitlabRepo = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { connectGitlabRepo } = require('./Gitlab/gitlabConnect')
        return await connectGitlabRepo({
            userId: auth.uid,
            projectId: data && data.projectId,
            token: data && data.token,
            repoUrl: data && data.repoUrl,
            baseBranch: data && data.baseBranch,
        })
    }
)

exports.importAssistantSkillsFromRepo = onCall(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { importAssistantSkillsFromRepo } = require('./Assistant/assistantSkillsImport')
        try {
            return await importAssistantSkillsFromRepo({
                userId: auth.uid,
                repoUrl: data && data.repoUrl,
                ref: data && data.ref,
                jobId: data && data.jobId,
            })
        } catch (error) {
            if (error.code === 'permission-denied') throw new HttpsError('permission-denied', error.message)
            throw new HttpsError('invalid-argument', error.message)
        }
    }
)

exports.disconnectGitlabRepo = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { disconnectGitlabRepo } = require('./Gitlab/gitlabConnect')
        return await disconnectGitlabRepo({
            userId: auth.uid,
            projectId: data && data.projectId,
            clearProjectRepo: !!(data && data.clearProjectRepo),
        })
    }
)

exports.connectGithubRepo = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { connectGithubRepo } = require('./Github/githubConnect')
        return await connectGithubRepo({
            userId: auth.uid,
            projectId: data && data.projectId,
            token: data && data.token,
            repoUrl: data && data.repoUrl,
            baseBranch: data && data.baseBranch,
        })
    }
)

exports.disconnectGithubRepo = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { disconnectGithubRepo } = require('./Github/githubConnect')
        return await disconnectGithubRepo({
            userId: auth.uid,
            projectId: data && data.projectId,
            clearProjectRepo: !!(data && data.clearProjectRepo),
        })
    }
)

exports.connectGcpProject = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { connectGcpProject } = require('./Gcp/gcpConnect')
        return await connectGcpProject({
            userId: auth.uid,
            projectId: data && data.projectId,
            serviceAccountKey: data && data.serviceAccountKey,
            gcpProjectId: data && data.gcpProjectId,
        })
    }
)

exports.disconnectGcpProject = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { disconnectGcpProject } = require('./Gcp/gcpConnect')
        return await disconnectGcpProject({
            userId: auth.uid,
            projectId: data && data.projectId,
        })
    }
)

exports.getVmSubscriptionStatus = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { getVmSubscriptionStatus } = require('./Assistant/vmSubscriptionAuth')
        return await getVmSubscriptionStatus({ userId: auth.uid })
    }
)

exports.getVmAgentSettings = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { getVmAgentSettings } = require('./Assistant/vmAgentSettings')
        return await getVmAgentSettings({ userId: auth.uid })
    }
)

exports.setDefaultVmAgent = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { setDefaultVmAgent } = require('./Assistant/vmAgentSettings')
        return await setDefaultVmAgent({ userId: auth.uid, agent: data && data.agent })
    }
)

exports.setDefaultVmAgentReasoningEffort = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { setDefaultVmAgentReasoningEffort } = require('./Assistant/vmAgentSettings')
        return await setDefaultVmAgentReasoningEffort({ userId: auth.uid, effort: data && data.effort })
    }
)

exports.connectVmSubscription = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { connectVmSubscription } = require('./Assistant/vmSubscriptionAuth')
        return await connectVmSubscription({
            userId: auth.uid,
            provider: data && data.provider,
            credential: data && data.credential,
        })
    }
)

exports.disconnectVmSubscription = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { disconnectVmSubscription } = require('./Assistant/vmSubscriptionAuth')
        return await disconnectVmSubscription({ userId: auth.uid, provider: data && data.provider })
    }
)

exports.saveVmApiKey = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { saveVmApiKey } = require('./Assistant/vmApiKeyAuth')
        return await saveVmApiKey({
            userId: auth.uid,
            provider: data && data.provider,
            apiKey: data && data.apiKey,
        })
    }
)

exports.testVmApiKey = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { testVmApiKey } = require('./Assistant/vmApiKeyAuth')
        return await testVmApiKey({ userId: auth.uid, provider: data && data.provider })
    }
)

exports.removeVmApiKey = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { removeVmApiKey } = require('./Assistant/vmApiKeyAuth')
        return await removeVmApiKey({ userId: auth.uid, provider: data && data.provider })
    }
)

exports.setVmCredentialMode = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { setVmCredentialMode } = require('./Assistant/vmApiKeyAuth')
        return await setVmCredentialMode({
            userId: auth.uid,
            provider: data && data.provider,
            mode: data && data.mode,
        })
    }
)

exports.connectAssistantMcpServer = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { connectAssistantMcpServer } = require('./MCP/mcpAssistantConnect')
        return await connectAssistantMcpServer({
            userId: auth.uid,
            projectId: data && data.projectId,
            assistantId: data && data.assistantId,
            server: data && data.server,
            secret: data && data.secret,
        })
    }
)

exports.disconnectAssistantMcpServer = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { disconnectAssistantMcpServer } = require('./MCP/mcpAssistantConnect')
        return await disconnectAssistantMcpServer({
            userId: auth.uid,
            projectId: data && data.projectId,
            assistantId: data && data.assistantId,
            serverId: data && data.serverId,
        })
    }
)

exports.beginMcpOAuth = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { beginMcpOAuth } = require('./MCP/mcpClientOAuth')
        return await beginMcpOAuth({ userId: auth.uid, serverUrl: data && data.serverUrl })
    }
)

exports.completeMcpOAuth = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')
        const { completeMcpOAuth } = require('./MCP/mcpClientOAuth')
        return await completeMcpOAuth({ userId: auth.uid, state: data && data.state })
    }
)

// Public redirect target for the MCP OAuth authorization-code flow. Reached via a
// hosting rewrite (/mcpClientOAuthCallback). Exchanges the code, then renders a tiny
// page that notifies the opener window and closes itself.
exports.mcpClientOAuthCallback = onRequest(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async (req, res) => {
        const state = (req.query && req.query.state) || ''
        const code = (req.query && req.query.code) || ''
        const oauthError = (req.query && req.query.error) || ''
        const renderPage = (ok, message) => {
            const payload = JSON.stringify({ type: 'mcp_oauth_complete', state, ok })
            res.set('Content-Type', 'text/html')
            res.status(200).send(
                `<!doctype html><html><body style="font-family:sans-serif;padding:24px">` +
                    `<p>${ok ? 'Authorization complete. You can close this window.' : 'Authorization failed.'}</p>` +
                    `<p style="color:#888">${String(message || '')}</p>` +
                    `<script>try{window.opener&&window.opener.postMessage(${payload},'*')}catch(e){}` +
                    `setTimeout(function(){window.close()},800)</script></body></html>`
            )
        }
        if (oauthError) return renderPage(false, oauthError)
        if (!state || !code) return renderPage(false, 'Missing code or state')
        try {
            const { exchangeMcpOAuthCode } = require('./MCP/mcpClientOAuth')
            await exchangeMcpOAuthCode({ code, state })
            return renderPage(true, '')
        } catch (err) {
            return renderPage(false, (err && err.message) || 'Token exchange failed')
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

exports.enrichContactViaLinkedIn = onCall(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { enrichContactViaLinkedIn } = require('./Apify/enrichContactViaLinkedIn')
            return await enrichContactViaLinkedIn(data, auth.uid)
        } else {
            throw new HttpsError('permission-denied', 'Authentication required')
        }
    }
)

exports.searchLinkedInProfile = onCall(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { searchLinkedInProfile } = require('./Apify/enrichContactViaLinkedIn')
            return await searchLinkedInProfile(data, auth.uid)
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
        const { resetUserFreePlan } = require('./Payment/SubscriptionsActions')
        await resetUserFreePlan()
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
            const { projectId, userId, gold, slimDate, timestamp, dayDate, rewardKey, objectId, objectType } = data
            return await earnGold(projectId, userId, gold, slimDate, timestamp, dayDate, {
                rewardKey,
                objectId,
                objectType,
            })
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.deductGoldSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { deductGold } = require('./Gold/goldHelper')
            const { gold, source, projectId, goalId, objectId, objectType, channel, note } = data
            return await deductGold(auth.uid, gold, {
                source,
                projectId,
                goalId,
                objectId,
                objectType,
                channel,
                note,
            })
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.refundGoldSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request

        console.log('refundGoldSecondGen: request received', {
            hasAuth: !!auth,
            uid: auth?.uid || '',
            gold: data?.gold,
        })

        if (auth) {
            const { refundGold } = require('./Gold/goldHelper')
            const { gold, source, projectId, goalId, objectId, objectType, channel, note } = data
            const result = await refundGold(auth.uid, gold, {
                source,
                projectId,
                goalId,
                objectId,
                objectType,
                channel,
                note,
            })

            console.log('refundGoldSecondGen: request completed', {
                uid: auth.uid,
                gold,
                success: result?.success,
                newBalance: result?.newBalance,
                message: result?.message,
            })

            return result
        } else {
            console.error('refundGoldSecondGen: missing auth')
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.adjustUserGoldSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request

        if (!auth) {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }

        await assertAdministrator(auth.uid)

        const { adjustGold } = require('./Gold/goldHelper')
        const { targetUserId, delta, note } = data || {}

        if (!targetUserId) {
            throw new HttpsError('invalid-argument', 'targetUserId is required')
        }

        const normalizedDelta = Number(delta)
        if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
            throw new HttpsError('invalid-argument', 'delta must be a non-zero number')
        }

        return await adjustGold(targetUserId, normalizedDelta, {
            source: 'admin_adjustment',
            channel: 'admin_panel',
            note,
        })
    }
)

// Consent-independent gold rollups: every gold ledger entry is aggregated into
// goldStats/daily/days/{YYYY-MM-DD} and goldStats/monthly/months/{YYYY-MM} so
// total earned/spent per day/month is exact (unlike GA, which only sees users who
// granted analytics consent). Idempotent via an aggregatedAt stamp on the source
// doc; backfill historical entries with migration/backfillGoldStats.js.
exports.aggregateGoldTransactionStatsSecondGen = onDocumentCreated(
    {
        document: `users/{userId}/goldTransactions/{transactionId}`,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { aggregateGoldTransaction } = require('./Gold/goldStatsAggregator')
        await aggregateGoldTransaction(event)
    }
)

// MENUBAR APP (Anna Alldone macOS menubar assistant)

exports.mintMenubarAppToken = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
        const { mintMenubarAppToken } = require('./MenubarApp/menubarApp')
        return await mintMenubarAppToken(auth.uid)
    }
)

exports.listMenubarAppTokens = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
        const { listMenubarAppTokens } = require('./MenubarApp/menubarApp')
        return await listMenubarAppTokens(auth.uid)
    }
)

exports.revokeMenubarAppToken = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
        const { revokeMenubarAppToken } = require('./MenubarApp/menubarApp')
        return await revokeMenubarAppToken(auth.uid, data?.tokenId)
    }
)

exports.menubarSession = onRequest(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleMenubarSession } = require('./MenubarApp/menubarApp')
        return await handleMenubarSession(req, res)
    }
)

exports.menubarGoldWebhook = onRequest(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleMenubarGoldWebhook } = require('./MenubarApp/menubarApp')
        return await handleMenubarGoldWebhook(req, res)
    }
)

exports.menubarProjects = onRequest(
    {
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleMenubarProjects } = require('./MenubarApp/menubarApp')
        return await handleMenubarProjects(req, res)
    }
)

exports.menubarPushNote = onRequest(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleMenubarPushNote } = require('./MenubarApp/menubarApp')
        return await handleMenubarPushNote(req, res)
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
        // Must return/await: without it the async reset was fire-and-forget and the
        // Cloud Function instance froze before it finished, so dailyGold was never
        // replenished and task-completion rewards silently failed ("No daily gold left").
        const { resetDailyGoldLimit } = require('./Gold/goldHelper')
        return resetDailyGoldLimit()
    }
)

// Hourly cleanup of expired MCP OAuth sessions (completed-but-unclaimed sessions
// hold tokens, so don't let them linger past their short TTL).
exports.cleanupExpiredMcpOAuthSessions = onSchedule(
    {
        schedule: '0 * * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '256MiB',
    },
    async () => {
        const { cleanupExpiredMcpOAuthSessions } = require('./MCP/mcpClientOAuth')
        await cleanupExpiredMcpOAuthSessions()
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

exports.distributeManualSkillPointsSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }

        const { processManualSkillPointDistribution } = require('./Skills/automaticSkillPointDistribution')
        const result = await processManualSkillPointDistribution(auth.uid)
        if (result?.status === 'failed') {
            throw new HttpsError('failed-precondition', result.error || 'Manual skill point distribution failed')
        }
        return result
    }
)

//AI ASSISTANTS

// Pre-load module at top level to avoid repeated require overhead
const { askToOpenAIBot } = require('./Assistant/assistantNormalTalk_optimized')

exports.askToBotSecondGen = onCall(
    {
        timeoutSeconds: 3600,
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
                userId: requestedUserId,
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
            const userId = auth.uid
            if (requestedUserId && requestedUserId !== userId) {
                console.warn('askToBotSecondGen: ignoring mismatched userId from payload', {
                    requestedUserId,
                    authUserId: userId,
                })
            }
            try {
                if (projectId && objectType && objectId) {
                    await assertObjectAccess(admin.firestore(), userId, projectId, objectType, objectId)
                } else if (projectId) {
                    await assertProjectAccess(userId, projectId)
                }
            } catch (error) {
                console.warn('askToBotSecondGen: access denied', {
                    userId,
                    projectId,
                    objectType,
                    objectId,
                    error: error.message,
                })
                throw new HttpsError('permission-denied', 'No access to requested chat context')
            }
            console.log('📊 [TIMING] Function setup complete, calling askToOpenAIBot:', {
                setupTime: `${Date.now() - functionEntryTime}ms`,
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                assistantId,
            })

            const {
                acquireAssistantRunLock,
                cancelAssistantRunLock,
                completeAssistantRunLock,
                failAssistantRunLock,
                isAssistantRunCancelledError,
            } = require('./Assistant/assistantRunIdempotency')
            const assistantRunLock = await acquireAssistantRunLock(admin.firestore(), {
                userId,
                messageId,
                projectId,
                objectType,
                objectId,
                assistantId,
            })
            if (!assistantRunLock.acquired) {
                console.warn('askToBotSecondGen: duplicate assistant run skipped', {
                    userId,
                    messageId,
                    projectId,
                    objectType,
                    objectId,
                    assistantId,
                    lockId: assistantRunLock.lockId,
                    reason: assistantRunLock.reason,
                })
                return {
                    success: true,
                    duplicate: true,
                    status: assistantRunLock.reason,
                    messageId,
                }
            }

            const askToOpenAIBotStart = Date.now()
            console.log('🚀 [TIMING] Invoking askToOpenAIBot now...')
            let result
            try {
                result = await askToOpenAIBot(
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
                    functionEntryTime, // Pass entry time for time-to-first-token tracking
                    assistantRunLock.lockId
                )
                await completeAssistantRunLock(assistantRunLock.lockRef)
            } catch (error) {
                if (isAssistantRunCancelledError(error)) {
                    await cancelAssistantRunLock(assistantRunLock.lockRef)
                    return {
                        success: true,
                        cancelled: true,
                        messageId,
                    }
                }
                await failAssistantRunLock(assistantRunLock.lockRef, error)
                throw error
            }

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

exports.cancelAssistantRunSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const requestStartedAt = Date.now()
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const userId = auth.uid
        const { projectId, objectType = 'tasks', objectId, commentId, runKind, runId } = data || {}
        if (!projectId || !objectId || !commentId || !runKind || !runId) {
            throw new HttpsError('invalid-argument', 'Missing assistant run cancellation fields')
        }
        if (!['chat', 'vm_job'].includes(runKind)) {
            throw new HttpsError('invalid-argument', 'Unsupported assistant run type')
        }

        try {
            await assertObjectAccess(admin.firestore(), userId, projectId, objectType, objectId)
        } catch (error) {
            console.warn('cancelAssistantRunSecondGen: access denied', {
                userId,
                projectId,
                objectType,
                objectId,
                error: error.message,
            })
            throw new HttpsError('permission-denied', 'No access to requested chat context')
        }

        const db = admin.firestore()
        const now = Date.now()
        let cancellationResult = null

        if (runKind === 'chat') {
            const { requestCancelAssistantRunLock } = require('./Assistant/assistantRunIdempotency')
            cancellationResult = await requestCancelAssistantRunLock(db.doc(`assistantRunLocks/${runId}`), userId)
        } else {
            const pendingRef = db.doc(`pendingWebhooks/${runId}`)
            cancellationResult = await db.runTransaction(async transaction => {
                const snapshot = await transaction.get(pendingRef)
                if (!snapshot.exists) return { success: false, reason: 'not_found' }
                const pending = snapshot.data() || {}
                if (pending.kind !== 'vm_job') return { success: false, reason: 'wrong_kind' }
                if (pending.userId !== userId) return { success: false, reason: 'permission_denied' }
                if (['completed', 'failed', 'cancelled'].includes(pending.status)) {
                    return { success: false, reason: 'already_settled', status: pending.status }
                }
                transaction.set(
                    pendingRef,
                    {
                        status: 'cancel_requested',
                        cancelRequestedAt: now,
                        cancelRequestedBy: userId,
                    },
                    { merge: true }
                )
                return { success: true, status: 'cancel_requested', data: pending }
            })
        }

        if (!cancellationResult?.success) {
            if (cancellationResult?.reason === 'permission_denied') {
                throw new HttpsError('permission-denied', 'Only the user who started the assistant run can stop it')
            }
            if (cancellationResult?.reason === 'already_settled') {
                return {
                    success: true,
                    status: cancellationResult.status,
                    alreadySettled: true,
                }
            }
            throw new HttpsError('not-found', 'Assistant run was not found')
        }

        if (runKind === 'vm_job' && cancellationResult.data?.cloudRunExecution) {
            try {
                const { cancelVmCloudRunExecution } = require('./Assistant/vmCloudRunLauncher')
                await cancelVmCloudRunExecution(cancellationResult.data.cloudRunExecution)
                await db.doc(`pendingWebhooks/${runId}`).set(
                    {
                        cloudRunCancelRequestedAt: now,
                        cloudRunCancelRequestSucceeded: true,
                    },
                    { merge: true }
                )
            } catch (error) {
                // Firestore cancellation remains authoritative and the worker also polls it.
                // Direct Cloud Run cancellation is a latency/cost optimization, not the only stop path.
                console.warn('cancelAssistantRunSecondGen: Cloud Run execution cancellation failed', {
                    runId,
                    error: error.message,
                })
                await db
                    .doc(`pendingWebhooks/${runId}`)
                    .set(
                        {
                            cloudRunCancelRequestedAt: now,
                            cloudRunCancelRequestSucceeded: false,
                            cloudRunCancelError: error.message,
                        },
                        { merge: true }
                    )
                    .catch(() => {})
            }
        }

        const commentRef = db.doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
        await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(commentRef)
            const comment = snapshot.exists ? snapshot.data() || {} : {}
            const assistantRun = comment.assistantRun || {}
            if (assistantRun.requestUserId && assistantRun.requestUserId !== userId) {
                throw new HttpsError('permission-denied', 'Only the user who started the assistant run can stop it')
            }
            // Don't clobber a run that finished streaming a real answer between the lock cancel and here.
            const alreadySettled = comment.isLoading === false
            if (runKind === 'chat' && !alreadySettled) {
                // Finalize the comment immediately so the spinner stops even if the run's process is
                // already dead (timeout/redeploy) — the live loop's own cancel check is only a backup.
                transaction.set(
                    commentRef,
                    {
                        commentText: 'Stopped.',
                        isLoading: false,
                        isThinking: false,
                        assistantRun: {
                            ...assistantRun,
                            kind: runKind,
                            runId,
                            requestUserId: assistantRun.requestUserId || userId,
                            status: 'cancelled',
                            cancelRequestedAt: now,
                            cancelRequestedBy: userId,
                            cancelledAt: now,
                        },
                    },
                    { merge: true }
                )
            } else {
                transaction.set(
                    commentRef,
                    {
                        assistantRun: {
                            ...assistantRun,
                            kind: runKind,
                            runId,
                            requestUserId: assistantRun.requestUserId || userId,
                            status: 'cancel_requested',
                            cancelRequestedAt: now,
                            cancelRequestedBy: userId,
                        },
                    },
                    { merge: true }
                )
            }
        })

        return {
            success: true,
            status: runKind === 'chat' ? 'cancelled' : 'cancel_requested',
            runKind,
            runId,
        }
    }
)

// Watchdog: finalize assistant chat runs whose process died (function timeout, redeploy, crash)
// without cleaning up. Such runs leave their lock flagged running/cancel_requested and their chat
// comment stuck on a spinner forever. Runs every 2 minutes; a live run can never exceed the
// askToBotSecondGen 60-minute timeout, so anything still "running" past the stuck threshold is dead.
exports.reconcileStuckAssistantRunsSecondGen = onSchedule(
    {
        schedule: '*/2 * * * *',
        timeZone: 'UTC',
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '256MiB',
    },
    async () => {
        const { reconcileStuckAssistantRunLocks } = require('./Assistant/assistantRunIdempotency')
        const result = await reconcileStuckAssistantRunLocks(admin.firestore())
        if (result.reconciled > 0) {
            console.log('🧹 ASSISTANT RUN WATCHDOG: reconciled stuck runs', result)
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
        timeoutSeconds: 3600,
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
                userId: requestedUserId,
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
            const userId = auth.uid
            if (requestedUserId && requestedUserId !== userId) {
                console.warn('generatePreConfigTaskResultSecondGen: ignoring mismatched userId from payload', {
                    requestedUserId,
                    authUserId: userId,
                })
            }
            try {
                if (projectId && taskId) {
                    await assertObjectAccess(admin.firestore(), userId, projectId, 'tasks', taskId)
                } else if (projectId) {
                    await assertProjectAccess(userId, projectId)
                }
            } catch (error) {
                console.warn('generatePreConfigTaskResultSecondGen: access denied', {
                    userId,
                    projectId,
                    taskId,
                    error: error.message,
                })
                throw new HttpsError('permission-denied', 'No access to requested task context')
            }
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

exports.getAssistantDelegationDescriptionStatusSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : ''
        const assistantId = typeof data?.assistantId === 'string' ? data.assistantId.trim() : ''
        if (!projectId || !assistantId) {
            throw new HttpsError('invalid-argument', 'projectId and assistantId are required')
        }

        await assertAssistantProjectAccess(auth.uid, projectId, assistantId)

        const {
            collectAssistantDelegationInputs,
            buildDelegationInputHash,
            buildDelegationCapabilitiesSummaryFromTasks,
            buildLegacyDelegationToolDescription,
            getEffectiveDelegationDescriptionSource,
            normalizeText,
        } = require('./Assistant/delegationToolDescriptionHelper')

        let inputs
        try {
            inputs = await collectAssistantDelegationInputs(projectId, assistantId)
        } catch (error) {
            if (error?.message === 'Assistant not found') {
                throw new HttpsError('not-found', 'Assistant not found')
            }
            throw error
        }
        const currentInputHash = buildDelegationInputHash(inputs)
        const assistant = inputs.assistant || {}
        const manual = normalizeText(assistant.delegationToolDescriptionManual, 1000)
        const storedInputHash = normalizeText(assistant.delegationToolDescriptionInputHash, 120)
        const isStale = !manual && storedInputHash !== currentInputHash

        let projectName = projectId
        try {
            const projectDoc = await admin.firestore().doc(`projects/${projectId}`).get()
            if (projectDoc.exists) {
                projectName = normalizeText(projectDoc.data()?.name, 120) || projectId
            }
        } catch (_) {}

        const capabilitiesSummary = buildDelegationCapabilitiesSummaryFromTasks(inputs.tasks || [])
        const legacyDescription = buildLegacyDelegationToolDescription({
            displayName: assistant.displayName,
            projectName,
            projectId,
            assistantDescription: assistant.description,
            capabilitiesSummary,
        })
        const effectiveDescription = manual || legacyDescription

        return {
            projectId,
            assistantId,
            delegationToolDescriptionManual: manual,
            delegationToolDescriptionGenerated: normalizeText(assistant.delegationToolDescriptionGenerated, 1000),
            delegationToolDescriptionGeneratedAt: assistant.delegationToolDescriptionGeneratedAt || null,
            delegationToolDescriptionInputHash: storedInputHash,
            currentInputHash,
            isStale,
            effectiveDescription,
            effectiveSource: getEffectiveDelegationDescriptionSource(assistant),
        }
    }
)

exports.generateAssistantDelegationDescriptionSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : ''
        const assistantId = typeof data?.assistantId === 'string' ? data.assistantId.trim() : ''
        const language = typeof data?.language === 'string' ? data.language : 'en'
        if (!projectId || !assistantId) {
            throw new HttpsError('invalid-argument', 'projectId and assistantId are required')
        }

        await assertAssistantProjectAccess(auth.uid, projectId, assistantId)

        const {
            collectAssistantDelegationInputs,
            buildDelegationInputHash,
            generateDelegationDescription,
            getEffectiveDelegationDescriptionSource,
            normalizeText,
        } = require('./Assistant/delegationToolDescriptionHelper')

        let inputs
        try {
            inputs = await collectAssistantDelegationInputs(projectId, assistantId)
        } catch (error) {
            if (error?.message === 'Assistant not found') {
                throw new HttpsError('not-found', 'Assistant not found')
            }
            throw error
        }
        const currentInputHash = buildDelegationInputHash(inputs)
        const generatedText = await generateDelegationDescription(inputs, language)
        const generatedAt = Date.now()

        await inputs.assistantRef.update({
            delegationToolDescriptionManual: generatedText,
            delegationToolDescriptionGenerated: generatedText,
            delegationToolDescriptionGeneratedAt: generatedAt,
            delegationToolDescriptionInputHash: currentInputHash,
            lastEditionDate: generatedAt,
            lastEditorId: auth.uid,
        })

        const updatedAssistant = {
            ...(inputs.assistant || {}),
            delegationToolDescriptionGenerated: generatedText,
            delegationToolDescriptionGeneratedAt: generatedAt,
            delegationToolDescriptionInputHash: currentInputHash,
        }

        return {
            projectId,
            assistantId,
            delegationToolDescriptionManual: normalizeText(generatedText, 1000),
            delegationToolDescriptionGenerated: normalizeText(generatedText, 1000),
            delegationToolDescriptionGeneratedAt: generatedAt,
            delegationToolDescriptionInputHash: currentInputHash,
            currentInputHash,
            isStale: false,
            effectiveDescription: normalizeText(generatedText, 1000),
            effectiveSource: getEffectiveDelegationDescriptionSource({
                ...updatedAssistant,
                delegationToolDescriptionManual: generatedText,
            }),
        }
    }
)

exports.discoverExternalToolsSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }

        const sourceUrl = data?.url
        if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
            throw new HttpsError('invalid-argument', 'A valid HTTPS URL is required')
        }

        try {
            const { discoverExternalToolsFromUrl } = require('./Assistant/externalToolsDiscovery')
            return await discoverExternalToolsFromUrl(sourceUrl)
        } catch (error) {
            console.error('discoverExternalToolsSecondGen failed:', error)
            throw new HttpsError('internal', error.message || 'Failed to discover external tools')
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
        const project = { id: event.params.projectId, ...event.data.data() }
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

exports.onCreateTaskCommentSecondGen = onDocumentCreated(
    {
        document: 'chatComments/{projectId}/tasks/{taskId}/comments/{commentId}',
        timeoutSeconds: 120,
        memory: '256MB',
        region: 'europe-west1',
    },
    async event => {
        const { captureTaskPriorityCommentFeedback } = require('./Assistant/taskPriorityLearning')
        const { projectId, taskId, commentId } = event.params
        try {
            await captureTaskPriorityCommentFeedback({
                projectId,
                taskId,
                commentId,
                commentData: event.data.data() || {},
            })
        } catch (error) {
            console.warn('Task priority learning comment feedback capture failed', {
                projectId,
                taskId,
                commentId,
                error: error.message,
            })
        }
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
            const { projectId, dateFormated, events, removeFromAllDates } = data
            const userId = auth.uid

            // Get user email from API connections
            const userDoc = await admin.firestore().collection('users').doc(userId).get()
            const userEmail = userDoc.exists ? userDoc.data().apisConnected?.[projectId]?.calendarEmail : null

            await removeCalendarTasks(userId, projectId, dateFormated, events, removeFromAllDates, userEmail).catch(
                console.error
            )
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.syncCalendarEventsSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (auth) {
            const { syncCalendarEvents } = require('./GoogleCalendar/serverSideCalendarSync')
            const { projectId, daysAhead } = data
            const userId = auth.uid
            return await syncCalendarEvents(userId, projectId, daysAhead)
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.getBookingSettingsSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        try {
            const { getBookingSettings } = require('./Booking/bookingSettings')
            return await getBookingSettings(auth.uid)
        } catch (error) {
            console.error('Error loading booking settings:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to load booking settings')
        }
    }
)

exports.saveBookingSettingsSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        try {
            const { saveBookingSettings } = require('./Booking/bookingSettings')
            return await saveBookingSettings(auth.uid, data?.settings || {})
        } catch (error) {
            console.error('Error saving booking settings:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('invalid-argument', error.message || 'Failed to save booking settings')
        }
    }
)

exports.bookingApi = onRequest(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async (req, res) => {
        const { bookingApiHandler } = require('./Booking/publicBooking')
        await bookingApiHandler(req, res)
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
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        console.log(
            '[createApiEmailTasksSecondGen] Function called, auth:',
            !!auth,
            'data keys:',
            Object.keys(data || {})
        )
        if (auth) {
            const { addUnreadMailsTask } = require('./apis/EmailIntegration')
            const { projectId, date, uid, unreadMails, email, timezone, provider } = data
            console.log('[createApiEmailTasksSecondGen] Calling addUnreadMailsTask with timezone:', timezone)
            await addUnreadMailsTask(projectId, uid, date, unreadMails, email, timezone, provider || 'google')
        } else {
            throw new HttpsError('permission-denied', 'You cannot do that ;)')
        }
    }
)

exports.syncMicrosoftUnreadEmailSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const { projectId, date, timezone } = data || {}
        if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required')

        try {
            const userData = await assertProjectAccess(auth.uid, projectId)
            const connection = userData.apisConnected?.[projectId] || {}
            if (connection.emailProvider !== 'microsoft') {
                throw new HttpsError('failed-precondition', 'Microsoft email is not connected for this project')
            }

            const { getUnreadMicrosoftInboxCount } = require('./Email/providers/microsoftEmailProvider')
            const { addUnreadMailsTask } = require('./apis/EmailIntegration')
            const result = await getUnreadMicrosoftInboxCount(auth.uid, projectId)
            await addUnreadMailsTask(
                projectId,
                auth.uid,
                date || Date.now(),
                result.unreadCount,
                result.emailAddress || connection.emailAddress || userData.email,
                timezone,
                'microsoft'
            )
            return { success: true, unreadMails: result.unreadCount, email: result.emailAddress }
        } catch (error) {
            console.error('Error syncing Microsoft unread email:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to sync Microsoft unread email')
        }
    }
)

exports.getEmailLineSummarySecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const { includeNeedsReply } = data || {}

        try {
            const { key, userData } = await assertEmailLineAccess(auth.uid, data || {})
            const { getEmailLineSummary } = require('./Email/emailLine/emailLineService')
            return await getEmailLineSummary(auth.uid, key, { userData, includeNeedsReply: !!includeNeedsReply })
        } catch (error) {
            if (error instanceof HttpsError) throw error
            if (error?.code === 'EMAIL_AUTH_EXPIRED') {
                throw new HttpsError('failed-precondition', 'EMAIL_AUTH_EXPIRED')
            }
            console.error('[getEmailLineSummarySecondGen] Error:', error)
            throw new HttpsError('internal', error.message || 'Failed to load email summary')
        }
    }
)

exports.listEmailLineMessagesSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const requestStartedAt = Date.now()
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const { labelId, pageToken } = data || {}
        if (!labelId) throw new HttpsError('invalid-argument', 'labelId is required')

        try {
            const { key, userData } = await assertEmailLineAccess(auth.uid, data || {})
            const accessCheckedAt = Date.now()
            const { listEmailLineMessages } = require('./Email/emailLine/emailLineService')
            const result = await listEmailLineMessages(auth.uid, key, labelId, { pageToken, userData })
            console.log('[emailLineTiming] callable', {
                accessMs: accessCheckedAt - requestStartedAt,
                serviceMs: Date.now() - accessCheckedAt,
                totalMs: Date.now() - requestStartedAt,
                page: pageToken ? 'next' : 'first',
                messageCount: result?.messages?.length || 0,
            })
            return result
        } catch (error) {
            if (error instanceof HttpsError) throw error
            if (error?.code === 'EMAIL_AUTH_EXPIRED') {
                throw new HttpsError('failed-precondition', 'EMAIL_AUTH_EXPIRED')
            }
            console.error('[listEmailLineMessagesSecondGen] Error:', error)
            throw new HttpsError('internal', error.message || 'Failed to list email messages')
        }
    }
)

exports.emailLineActionSecondGen = onCall(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { data, auth } = request
        if (!auth) throw new HttpsError('permission-denied', 'You cannot do that ;)')

        const { action, messageIds, labelId, labelName, guidance, sourceProjectId, sourceTaskId } = data || {}
        if (!action) throw new HttpsError('invalid-argument', 'action is required')

        try {
            const { key, userData } = await assertEmailLineAccess(auth.uid, data || {})
            const { performEmailLineAction } = require('./Email/emailLine/emailLineService')
            return await performEmailLineAction(auth.uid, key, {
                action,
                messageIds,
                labelId,
                labelName,
                guidance,
                sourceProjectId,
                sourceTaskId,
                userData,
            })
        } catch (error) {
            if (error instanceof HttpsError) throw error
            if (error?.code === 'EMAIL_AUTH_EXPIRED') {
                throw new HttpsError('failed-precondition', 'EMAIL_AUTH_EXPIRED')
            }
            console.error('[emailLineActionSecondGen] Error:', error)
            throw new HttpsError('internal', error.message || 'Failed to perform email action')
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
        timeoutSeconds: 3600, // 60 minutes; recurring assistant runs have a 55-minute internal limit
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { checkAndExecuteRecurringTasks } = require('./Assistant/assistantRecurringTasks')
        await checkAndExecuteRecurringTasks()
    }
)

// ASSISTANT HEARTBEAT
exports.checkAssistantHeartbeats = onSchedule(
    {
        schedule: '*/5 * * * *',
        timeoutSeconds: 3600,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { dispatchDueHeartbeats } = require('./Assistant/assistantHeartbeatDispatcher')
        await dispatchDueHeartbeats()
    }
)

exports.runAssistantHeartbeat = onTaskDispatched(
    {
        region: 'europe-west1',
        timeoutSeconds: 1800,
        memory: '512MiB',
        retryConfig: { maxAttempts: 1 },
        rateLimits: { maxConcurrentDispatches: 5, maxDispatchesPerSecond: 2 },
    },
    async req => {
        const { executeScheduledHeartbeat } = require('./Assistant/assistantHeartbeat')
        await executeScheduledHeartbeat(req.data || {})
    }
)

exports.reconcileAssistantHeartbeatSchedules = onSchedule(
    {
        schedule: '17 2 * * *',
        timeZone: 'UTC',
        timeoutSeconds: 3600,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async () => {
        const { reconcileAllHeartbeatSchedules } = require('./Assistant/assistantHeartbeatSchedule')
        const result = await reconcileAllHeartbeatSchedules()
        console.log('Heartbeat schedule reconciliation completed', result)
    }
)

// Deployed callable name predates the auto-postpone rename; keep it so shipped clients calling it don't break.
exports.autoReminderTasksSecondGen = onCall(
    {
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')

        try {
            const { executeAutoPostponeTasks } = require('./Tasks/autoPostponeTasksCallable')
            return await executeAutoPostponeTasks({ actorUserId: auth.uid, data })
        } catch (error) {
            if (error instanceof HttpsError) throw error
            const supportedCodes = new Set(['invalid-argument', 'permission-denied', 'not-found'])
            const code = supportedCodes.has(error.code) ? error.code : 'internal'
            console.error('[autoReminderTasksSecondGen] Failed', {
                actorUserId: auth.uid,
                code,
                error: error.message,
            })
            throw new HttpsError(code, code === 'internal' ? 'Failed to auto-postpone tasks' : error.message)
        }
    }
)

exports.postponeGoalWithUndoSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')

        try {
            const { executeGoalPostpone } = require('./Goals/goalPostponeService')
            return await executeGoalPostpone({ actorUserId: auth.uid, data })
        } catch (error) {
            const supportedCodes = new Set([
                'invalid-argument',
                'permission-denied',
                'not-found',
                'failed-precondition',
            ])
            const code = supportedCodes.has(error.code) ? error.code : 'internal'
            console.error('[postponeGoalWithUndoSecondGen] Failed', {
                userId: auth.uid,
                projectId: data?.projectId,
                goalId: data?.goalId,
                code,
                error: error.message,
            })
            throw new HttpsError(code, code === 'internal' ? 'Failed to postpone goal' : error.message)
        }
    }
)

exports.reverseUndoActionSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '256MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'Authentication required')

        const actionId = data?.actionId
        const direction = data?.direction
        if (!actionId || !['undo', 'redo'].includes(direction)) {
            throw new HttpsError('invalid-argument', 'A valid actionId and direction are required')
        }

        try {
            const { reverseAction } = require('./shared/UndoActionService')
            return await reverseAction({
                db: admin.firestore(),
                userId: auth.uid,
                actionId,
                direction,
            })
        } catch (error) {
            const supportedCodes = new Set(['permission-denied', 'not-found', 'failed-precondition'])
            const code = supportedCodes.has(error.code) ? error.code : 'internal'
            console.error('[reverseUndoActionSecondGen] Failed', {
                userId: auth.uid,
                actionId,
                direction,
                code,
                error: error.message,
            })
            throw new HttpsError(code, code === 'internal' ? 'Failed to reverse action' : error.message)
        }
    }
)

exports.cleanupExpiredUndoActionsSecondGen = onSchedule(
    {
        schedule: '17 3 * * *',
        timeZone: 'UTC',
        timeoutSeconds: 120,
        memory: '256MiB',
        region: 'europe-west1',
    },
    async () => {
        const { cleanupExpiredUndoActions } = require('./shared/UndoActionService')
        const result = await cleanupExpiredUndoActions(admin.firestore())
        console.log('[cleanupExpiredUndoActionsSecondGen] Completed', result)
    }
)

exports.autoPostponeOverdueTasksSecondGen = onSchedule(
    {
        schedule: '0 * * * *',
        timeoutSeconds: 900,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async () => {
        const { checkAndAutoPostponeTasks } = require('./Tasks/autoPostponeTasksCloud')
        return await checkAndAutoPostponeTasks()
    }
)

exports.renewExpiredOKRsSecondGen = onSchedule(
    {
        schedule: '0 * * * *',
        timeoutSeconds: 900,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async () => {
        const { processExpiredOKRs } = require('./OKRs/okrRenewal')
        return await processExpiredOKRs()
    }
)

exports.processLinearGoalMilestonesSecondGen = onSchedule(
    {
        schedule: '0 * * * *',
        timeoutSeconds: 900,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async () => {
        const { processLinearGoalMilestones } = require('./Goals/linearGoalMilestones')
        return await processLinearGoalMilestones()
    }
)

exports.pollGmailLabelingSecondGen = onSchedule(
    {
        schedule: '*/5 * * * *',
        timeoutSeconds: 900,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async () => {
        const { processEnabledGmailLabelingConfigs } = require('./Gmail/serverSideGmailLabelingSync')
        return await processEnabledGmailLabelingConfigs()
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

// VM LLM PROXY - Public endpoint the sandbox agent calls instead of api.anthropic.com /
// api.openai.com. It authenticates a short-lived per-job token, swaps in the real platform key
// server-side, and streams the response back, so the real Anthropic/OpenAI key never enters the
// VM (see functions/Assistant/vmLlmProxy.js). Long timeout for streamed model responses.
exports.vmLlmProxy = onRequest(
    {
        timeoutSeconds: 600,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleProxyRequest } = require('./Assistant/vmLlmProxy')
        await handleProxyRequest(req, res)
    }
)

// LEGACY RUN VM JOB - retained as a rollback target while the detached Cloud Run
// Job migration is validated. New execute_task_in_vm launches do not enqueue it.
exports.runVmJob = onTaskDispatched(
    {
        region: 'europe-west1',
        timeoutSeconds: VM_JOB_WORKER_TIMEOUT_SECONDS, // 30 min — Cloud Tasks HTTP dispatch ceiling
        memory: '1GiB',
        retryConfig: { maxAttempts: 1 }, // never re-run an expensive VM job
        rateLimits: VM_JOB_QUEUE_RATE_LIMITS,
    },
    async req => {
        const correlationId = req.data && req.data.correlationId
        if (!correlationId) {
            console.error('🖥️ RUN VM JOB: Missing correlationId in task payload')
            return
        }
        const { runVmJobByCorrelationId } = require('./Assistant/vmJobRunner')
        await runVmJobByCorrelationId(correlationId)
    }
)

// PAUSE IDLE VM SESSIONS - pause running E2B sandboxes idle past the keep-alive window
exports.pauseIdleVmSessions = onSchedule(
    {
        schedule: 'every 2 minutes',
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { pauseIdleVmSessions } = require('./Assistant/vmJobRunner')
        await pauseIdleVmSessions()
    }
)

// CLEANUP IDLE VM SESSIONS - delete paused E2B sandboxes (and their session docs) idle > TTL
exports.cleanupIdleVmSessions = onSchedule(
    {
        schedule: 'every 6 hours',
        timeoutSeconds: 300,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async event => {
        const { cleanupIdleVmSessions } = require('./Assistant/vmJobRunner')
        await cleanupIdleVmSessions()
    }
)

// Reconcile ambiguous Cloud Run launch responses. A timed-out HTTP response may
// still have created an execution, so this avoids both duplicate launches and
// premature Gold refunds.
exports.reconcileVmCloudRunLaunches = onSchedule(
    {
        schedule: 'every 2 minutes',
        timeoutSeconds: 120,
        memory: '256MiB',
        region: 'europe-west1',
    },
    async () => {
        const { reconcileUnknownVmCloudRunLaunches } = require('./Assistant/vmJob')
        const result = await reconcileUnknownVmCloudRunLaunches()
        if (result.checked || result.errors) {
            console.log('🖥️ VM JOB: Cloud Run launch reconciliation complete', result)
        }
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
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        const { initiateOAuth } = require('./GoogleOAuth/googleOAuthHandler')
        const { projectId, service, returnUrl, connectionId } = data
        const userId = auth.uid

        try {
            const authUrl = await initiateOAuth(userId, projectId, service, returnUrl, connectionId)
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
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: true,
        },
    },
    async (req, res) => {
        const { handleOAuthCallback } = require('./GoogleOAuth/googleOAuthHandler')
        const { code, state, error } = req.query

        if (error) {
            console.error('OAuth error from Google:', error)
            res.send(`
                <script>
                    window.opener.postMessage({ type: 'oauth_error', error: '${error}' }, '*');
                    window.close();
                </script>
            `)
            return
        }

        try {
            const result = await handleOAuthCallback(code, state)

            if (result.returnUrl) {
                // Return to the app
                res.redirect(result.returnUrl)
                return
            }

            res.send(`
                <script>
                    window.opener.postMessage({ type: 'oauth_success', result: ${JSON.stringify(result)} }, '*');
                    window.close();
                </script>
            `)
        } catch (err) {
            console.error('Error in OAuth callback:', err)
            res.send(`
                <script>
                    window.opener.postMessage({ type: 'oauth_error', error: '${err.message}' }, '*');
                    window.close();
                </script>
            `)
        }
    }
)

// Get fresh access token
exports.googleOAuthGetToken = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        const { getAccessToken } = require('./GoogleOAuth/googleOAuthHandler')
        const { projectId, service } = data
        const userId = auth.uid

        try {
            const accessToken = await getAccessToken(userId, projectId, service)
            return { accessToken }
        } catch (error) {
            console.error('Error getting access token:', error)
            throw new HttpsError('internal', `Failed to get access token: ${error.message}`)
        }
    }
)

// Revoke access
exports.googleOAuthRevoke = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        const { revokeAccess } = require('./GoogleOAuth/googleOAuthHandler')
        const { projectId, service } = data
        const userId = auth.uid

        try {
            return await revokeAccess(userId, projectId, service)
        } catch (error) {
            console.error('Error revoking access:', error)
            throw new HttpsError('internal', `Failed to revoke access: ${error.message}`)
        }
    }
)

// Check credentials status
exports.googleOAuthCheckCredentials = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) {
            throw new HttpsError('permission-denied', 'User must be authenticated')
        }

        const { getCredentialStatus } = require('./GoogleOAuth/googleOAuthHandler')
        const { projectId, service } = data
        const userId = auth.uid

        try {
            return await getCredentialStatus(userId, projectId, service)
        } catch (error) {
            console.error('Error checking credentials:', error)
            throw new HttpsError('internal', `Failed to check credentials: ${error.message}`)
        }
    }
)

// MICROSOFT OAUTH - Server-side OAuth for Outlook Email and Microsoft Calendar

exports.microsoftOAuthInitiate = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { initiateOAuth } = require('./MicrosoftOAuth/microsoftOAuthHandler')
        const { projectId, service, returnUrl, connectionId } = data || {}
        if (!projectId && !connectionId) {
            throw new HttpsError('invalid-argument', 'projectId or connectionId is required')
        }

        try {
            if (projectId) await assertProjectAccess(auth.uid, projectId)
            else await assertConnectionAccess(auth.uid, connectionId)
            const authUrl = await initiateOAuth(auth.uid, projectId, service, returnUrl, connectionId)
            return { authUrl }
        } catch (error) {
            console.error('Error initiating Microsoft OAuth:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', `Failed to initiate Microsoft OAuth: ${error.message}`)
        }
    }
)

exports.microsoftOAuthCallback = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: {
            origin: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['*'],
            credentials: true,
        },
    },
    async (req, res) => {
        const { handleOAuthCallback } = require('./MicrosoftOAuth/microsoftOAuthHandler')
        const { code, state, error, error_description } = req.query

        if (error) {
            const message = String(error_description || error)
            console.error('OAuth error from Microsoft:', message)
            res.send(`
                <script>
                    window.opener.postMessage({ type: 'oauth_error', error: ${JSON.stringify(message)} }, '*');
                    window.close();
                </script>
            `)
            return
        }

        try {
            const result = await handleOAuthCallback(code, state)
            if (result.returnUrl) {
                res.redirect(result.returnUrl)
                return
            }

            res.send(`
                <script>
                    window.opener.postMessage({ type: 'oauth_success', result: ${JSON.stringify(result)} }, '*');
                    window.close();
                </script>
            `)
        } catch (err) {
            console.error('Error in Microsoft OAuth callback:', err)
            res.send(`
                <script>
                    window.opener.postMessage({ type: 'oauth_error', error: ${JSON.stringify(err.message)} }, '*');
                    window.close();
                </script>
            `)
        }
    }
)

// Note: there is intentionally no `microsoftOAuthGetToken` callable. Microsoft
// Graph access tokens are used only server-side (functions/MicrosoftGraph/graphClient.js)
// and must never be returned to the browser. The client checks connection state via
// `microsoftOAuthCheckCredentials` instead.

exports.microsoftOAuthRevoke = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { revokeAccess } = require('./MicrosoftOAuth/microsoftOAuthHandler')
        const { projectId, service } = data || {}
        if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required')

        try {
            await assertProjectAccess(auth.uid, projectId)
            return await revokeAccess(auth.uid, projectId, service)
        } catch (error) {
            console.error('Error revoking Microsoft access:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', `Failed to revoke Microsoft access: ${error.message}`)
        }
    }
)

exports.microsoftOAuthCheckCredentials = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { getCredentialStatus } = require('./MicrosoftOAuth/microsoftOAuthHandler')
        const { projectId, service } = data || {}
        if (!projectId) throw new HttpsError('invalid-argument', 'projectId is required')

        try {
            await assertProjectAccess(auth.uid, projectId)
            return await getCredentialStatus(auth.uid, projectId, service)
        } catch (error) {
            console.error('Error checking Microsoft credentials:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', `Failed to check Microsoft credentials: ${error.message}`)
        }
    }
)

exports.upsertGmailLabelingConfigSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { config } = data || {}

        try {
            const { key, userData, connection } = await assertEmailLineAccess(auth.uid, data || {})
            assertPremiumFeatureAccess(userData, 'Gmail labeling')
            const gmailEmail =
                connection?.emailAddress || userData.apisConnected?.[key]?.gmailEmail || userData.email || ''
            const { upsertGmailLabelingConfig } = require('./Gmail/serverSideGmailLabelingSync')
            const savedConfig = await upsertGmailLabelingConfig(auth.uid, key, config || {}, gmailEmail, userData)
            return { config: savedConfig }
        } catch (error) {
            console.error('Error saving Gmail labeling config:', error)
            if (error instanceof HttpsError) throw error
            if (error?.validationErrors) {
                throw new HttpsError('invalid-argument', error.validationErrors.join(' '))
            }
            throw new HttpsError('internal', error.message || 'Failed to save Gmail labeling config')
        }
    }
)

exports.getGmailLabelingConfigSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        try {
            const { key, userData, connection } = await assertEmailLineAccess(auth.uid, data || {})
            assertPremiumFeatureAccess(userData, 'Gmail labeling')
            const gmailEmail =
                connection?.emailAddress || userData.apisConnected?.[key]?.gmailEmail || userData.email || ''
            const { getGmailLabelingConfigWithState } = require('./Gmail/serverSideGmailLabelingSync')
            return await getGmailLabelingConfigWithState(auth.uid, key, gmailEmail, userData)
        } catch (error) {
            console.error('Error loading Gmail labeling config:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to load Gmail labeling config')
        }
    }
)

exports.submitEmailLabelFeedbackSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { messageId, verdict, correctLabel, note, correctLabelName, currentLabelId, correctFollowUpType } =
            data || {}
        if (!messageId) throw new HttpsError('invalid-argument', 'messageId is required')

        try {
            const { key, userData } = await assertEmailLineAccess(auth.uid, data || {})
            assertPremiumFeatureAccess(userData, 'Gmail labeling')
            const { submitEmailLabelFeedback } = require('./Gmail/gmailLabelFeedback')
            return await submitEmailLabelFeedback({
                userId: auth.uid,
                userData,
                projectId: key,
                messageId,
                verdict,
                correctLabel,
                note,
                correctLabelName,
                currentLabelId,
                correctFollowUpType,
            })
        } catch (error) {
            console.error('Error submitting email label feedback:', error)
            if (error instanceof HttpsError) throw error
            if (error?.code === 'FEEDBACK_LIMIT') throw new HttpsError('resource-exhausted', error.message)
            if (error?.code === 'LABELING_NOT_CONFIGURED' || error?.code === 'AUDIT_ENTRY_NOT_FOUND') {
                throw new HttpsError('failed-precondition', error.message)
            }
            throw new HttpsError('internal', error.message || 'Failed to submit email label feedback')
        }
    }
)

exports.upsertCalendarProjectRoutingConfigSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { config } = data || {}

        try {
            const { key, userData, connection } = await assertEmailLineAccess(auth.uid, data || {})
            assertPremiumFeatureAccess(userData, 'Calendar project routing')
            const calendarEmail =
                connection?.emailAddress || userData.apisConnected?.[key]?.calendarEmail || userData.email || ''
            const { upsertCalendarProjectRoutingConfig } = require('./GoogleCalendar/calendarProjectRoutingConfig')
            const savedConfig = await upsertCalendarProjectRoutingConfig(auth.uid, key, config || {}, calendarEmail)
            return { config: savedConfig }
        } catch (error) {
            console.error('Error saving Calendar project routing config:', error)
            if (error instanceof HttpsError) throw error
            if (error?.validationErrors) {
                throw new HttpsError('invalid-argument', error.validationErrors.join(' '))
            }
            throw new HttpsError('internal', error.message || 'Failed to save Calendar project routing config')
        }
    }
)

exports.getCalendarProjectRoutingConfigSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        try {
            const { key, userData, connection } = await assertEmailLineAccess(auth.uid, data || {})
            assertPremiumFeatureAccess(userData, 'Calendar project routing')
            const calendarEmail =
                connection?.emailAddress || userData.apisConnected?.[key]?.calendarEmail || userData.email || ''
            const {
                getCalendarProjectRoutingConfigWithPreview,
            } = require('./GoogleCalendar/calendarProjectRoutingConfig')
            return await getCalendarProjectRoutingConfigWithPreview(auth.uid, key, calendarEmail, userData)
        } catch (error) {
            console.error('Error loading Calendar project routing config:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to load Calendar project routing config')
        }
    }
)

exports.setDefaultGmailConnectionSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { projectId, connectionId, isDefault } = data || {}
        if (!projectId && !connectionId) {
            throw new HttpsError('invalid-argument', 'projectId or connectionId is required')
        }

        try {
            const {
                CONNECTION_SERVICE_EMAIL,
                buildConnectionId,
                findConnectionsForProject,
                materializeConnectionsMap,
                resolveEmailConnection,
            } = require('./Integrations/providerConnections')

            let userData
            let targetConnectionId = connectionId || null
            if (connectionId) {
                const access = await assertConnectionAccess(auth.uid, connectionId)
                userData = access.userData
            } else {
                userData = await assertProjectAccess(auth.uid, projectId)
                const [match] = findConnectionsForProject(userData, CONNECTION_SERVICE_EMAIL, projectId)
                if (!match) {
                    throw new HttpsError('failed-precondition', 'Email is not connected for this project')
                }
                targetConnectionId = match.connectionId
            }

            const updateData = {}
            const shouldSetDefault = !!isDefault

            // Authoritative account-level map: exactly 0..1 connection is the default.
            const connectionsMap = materializeConnectionsMap(CONNECTION_SERVICE_EMAIL, userData)
            if (!connectionsMap[targetConnectionId]) {
                throw new HttpsError('failed-precondition', 'Email connection not found')
            }
            Object.keys(connectionsMap).forEach(id => {
                connectionsMap[id].isDefaultAccount = shouldSetDefault && id === targetConnectionId
            })
            updateData.emailConnections = connectionsMap

            // Legacy per-project mirror for not-yet-updated clients.
            const apisConnected = userData.apisConnected || {}
            Object.keys(apisConnected).forEach(connectedProjectId => {
                const resolved = resolveEmailConnection(apisConnected[connectedProjectId])
                if (!resolved.connected || !resolved.emailAddress) return
                const entryConnectionId = buildConnectionId(
                    CONNECTION_SERVICE_EMAIL,
                    resolved.provider,
                    resolved.emailAddress
                )
                updateData[`apisConnected.${connectedProjectId}.emailDefault`] =
                    shouldSetDefault && entryConnectionId === targetConnectionId
                updateData[`apisConnected.${connectedProjectId}.gmailDefault`] =
                    resolved.provider === 'google' && shouldSetDefault && entryConnectionId === targetConnectionId
            })

            await admin.firestore().doc(`users/${auth.uid}`).update(updateData)

            return {
                success: true,
                projectId: projectId || null,
                connectionId: targetConnectionId,
                isDefault: shouldSetDefault,
            }
        } catch (error) {
            console.error('Error setting default Email connection:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to update default Email connection')
        }
    }
)

exports.setDefaultCalendarConnectionSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { projectId, connectionId, isDefault } = data || {}
        if (!projectId && !connectionId) {
            throw new HttpsError('invalid-argument', 'projectId or connectionId is required')
        }

        try {
            const {
                CONNECTION_SERVICE_CALENDAR,
                buildConnectionId,
                findConnectionsForProject,
                materializeConnectionsMap,
                resolveCalendarConnection,
            } = require('./Integrations/providerConnections')

            let userData
            let targetConnectionId = connectionId || null
            if (connectionId) {
                const access = await assertConnectionAccess(auth.uid, connectionId)
                userData = access.userData
            } else {
                userData = await assertProjectAccess(auth.uid, projectId)
                const [match] = findConnectionsForProject(userData, CONNECTION_SERVICE_CALENDAR, projectId)
                if (!match) {
                    throw new HttpsError('failed-precondition', 'Calendar is not connected for this project')
                }
                targetConnectionId = match.connectionId
            }

            const updateData = {}
            const shouldSetDefault = !!isDefault

            const connectionsMap = materializeConnectionsMap(CONNECTION_SERVICE_CALENDAR, userData)
            if (!connectionsMap[targetConnectionId]) {
                throw new HttpsError('failed-precondition', 'Calendar connection not found')
            }
            Object.keys(connectionsMap).forEach(id => {
                connectionsMap[id].isDefaultAccount = shouldSetDefault && id === targetConnectionId
            })
            updateData.calendarConnections = connectionsMap

            // Legacy per-project mirror for not-yet-updated clients.
            const apisConnected = userData.apisConnected || {}
            Object.keys(apisConnected).forEach(connectedProjectId => {
                const resolved = resolveCalendarConnection(apisConnected[connectedProjectId])
                if (!resolved.connected || !resolved.emailAddress) return
                const entryConnectionId = buildConnectionId(
                    CONNECTION_SERVICE_CALENDAR,
                    resolved.provider,
                    resolved.emailAddress
                )
                updateData[`apisConnected.${connectedProjectId}.calendarDefault`] =
                    shouldSetDefault && entryConnectionId === targetConnectionId
            })

            await admin.firestore().doc(`users/${auth.uid}`).update(updateData)

            return {
                success: true,
                projectId: projectId || null,
                connectionId: targetConnectionId,
                isDefault: shouldSetDefault,
            }
        } catch (error) {
            console.error('Error setting default Calendar connection:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to update default Calendar connection')
        }
    }
)

// Change the required default project of an account-level connection. Also inline-migrates
// the connection's project-keyed private docs (labeling config/state, routing config,
// token) to connection-keyed ids so the change never strands a legacy-keyed sync.
exports.setConnectionDefaultProjectSecondGen = onCall(
    {
        timeoutSeconds: 120,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { connectionId, defaultProjectId } = data || {}
        if (!connectionId) throw new HttpsError('invalid-argument', 'connectionId is required')
        if (!defaultProjectId) throw new HttpsError('invalid-argument', 'defaultProjectId is required')

        try {
            const { connection } = await assertConnectionAccess(auth.uid, connectionId)
            const userData = await assertProjectAccess(auth.uid, defaultProjectId)
            const {
                buildConnectionId,
                getConnectionsMapField,
                materializeConnectionsMap,
                resolveCalendarConnection,
                resolveEmailConnection,
            } = require('./Integrations/providerConnections')
            const { migrateConnectionDocs } = require('./Integrations/connectionDocMigration')

            const service = connectionId.startsWith('calendar_') ? 'calendar' : 'email'
            const mapField = getConnectionsMapField(service)

            // Move the connection's project-keyed docs onto connection ids first — after
            // that, the default project is just one field on the connection.
            const resolver = service === 'calendar' ? resolveCalendarConnection : resolveEmailConnection
            const apisConnected = userData.apisConnected || {}
            const sourceProjectIds = Object.keys(apisConnected).filter(legacyProjectId => {
                const resolved = resolver(apisConnected[legacyProjectId] || {})
                return (
                    resolved.connected &&
                    resolved.emailAddress &&
                    buildConnectionId(service, resolved.provider, resolved.emailAddress) === connectionId
                )
            })
            await migrateConnectionDocs(auth.uid, connection, sourceProjectIds)

            const connectionsMap = materializeConnectionsMap(service, userData)
            if (!connectionsMap[connectionId]) {
                throw new HttpsError('failed-precondition', 'Connection not found')
            }
            connectionsMap[connectionId].defaultProjectId = defaultProjectId

            await admin
                .firestore()
                .doc(`users/${auth.uid}`)
                .update({ [mapField]: connectionsMap })

            return { success: true, connectionId, defaultProjectId }
        } catch (error) {
            console.error('Error setting connection default project:', error)
            if (error instanceof HttpsError) throw error
            throw new HttpsError('internal', error.message || 'Failed to update connection default project')
        }
    }
)

exports.runGmailLabelingSyncSecondGen = onCall(
    {
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { auth, data } = request
        if (!auth) throw new HttpsError('permission-denied', 'User must be authenticated')

        const { forceBootstrap } = data || {}

        try {
            const { key, userData } = await assertEmailLineAccess(auth.uid, data || {})
            assertPremiumFeatureAccess(userData, 'Gmail labeling')
            const { syncGmailLabeling } = require('./Gmail/serverSideGmailLabelingSync')
            return await syncGmailLabeling(auth.uid, key, { forceBootstrap: !!forceBootstrap })
        } catch (error) {
            console.error('Error running Gmail labeling sync:', error)
            if (error instanceof HttpsError) throw error
            if (error?.name === 'GmailSyncLockedError') {
                throw new HttpsError('aborted', error.message)
            }
            throw new HttpsError('internal', error.message || 'Failed to run Gmail labeling sync')
        }
    }
)

exports.transcribeMeetingAudio = require('./Notes/transcribeMeeting').transcribeMeetingAudio

// WHATSAPP INCOMING MESSAGE - Receives messages from Twilio WhatsApp webhook
exports.whatsAppIncomingMessage = onRequest(
    {
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleIncomingWhatsAppMessage } = require('./WhatsApp/whatsAppIncomingHandler')
        await handleIncomingWhatsAppMessage(req, res)
    }
)

// WHATSAPP ASSISTANT CALLING - Twilio inbound call routing, OpenAI SIP acceptance, and sideband controller
exports.whatsAppIncomingCall = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        // Keep one instance warm: this is the Twilio entry point for a live phone call, so a
        // cold start here adds seconds of dead air before the caller can be connected to Anna.
        minInstances: 1,
    },
    async (req, res) => {
        const { handleIncomingWhatsAppCall } = require('./WhatsApp/whatsAppCallTwilioWebhook')
        await handleIncomingWhatsAppCall(req, res)
    }
)

exports.whatsAppCallStatusCallback = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleWhatsAppCallStatus } = require('./WhatsApp/whatsAppCallTwilioWebhook')
        await handleWhatsAppCallStatus(req, res)
    }
)

exports.phoneIncomingCall = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        minInstances: 1,
    },
    async (req, res) => {
        const { handleIncomingPhoneCall } = require('./WhatsApp/whatsAppCallTwilioWebhook')
        await handleIncomingPhoneCall(req, res)
    }
)

exports.phoneCallStatusCallback = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handlePhoneCallStatus } = require('./WhatsApp/whatsAppCallTwilioWebhook')
        await handlePhoneCallStatus(req, res)
    }
)

exports.startAssistantBrowserCallSecondGen = onCall(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        cors: true,
    },
    async request => {
        const { startAssistantBrowserCall } = require('./WhatsApp/assistantBrowserCall')
        return startAssistantBrowserCall(request.data, request.auth)
    }
)

exports.openAIRealtimeCallWebhook = onRequest(
    {
        timeoutSeconds: 60,
        memory: '512MiB',
        region: 'europe-west1',
        // Keep one instance warm: OpenAI calls this to accept the live SIP call, and a cold
        // start delays the accept (observed ~7.7s), which the caller experiences as silence.
        minInstances: 1,
    },
    async (req, res) => {
        const { handleOpenAIRealtimeCallWebhook } = require('./WhatsApp/whatsAppCallOpenAIWebhook')
        await handleOpenAIRealtimeCallWebhook(req, res)
    }
)

exports.runWhatsAppRealtimeCall = onTaskDispatched(
    {
        region: 'europe-west1',
        timeoutSeconds: 1800,
        memory: '1GiB',
        retryConfig: { maxAttempts: 1 },
        rateLimits: { maxConcurrentDispatches: 5 },
        // Keep one instance warm: this is the sideband controller that connects to OpenAI
        // Realtime. A cold start here was observed to push setup latency to ~14.5s, long
        // enough that the caller hangs up before Anna can greet (the call "doesn't connect").
        minInstances: 1,
    },
    async req => {
        const sessionId = req.data && req.data.sessionId
        if (!sessionId) return
        const { runWhatsAppRealtimeCall } = require('./WhatsApp/whatsAppCallController')
        await runWhatsAppRealtimeCall(sessionId)
    }
)

exports.cleanupStaleWhatsAppCalls = onSchedule(
    {
        schedule: 'every 5 minutes',
        region: 'europe-west1',
        timeoutSeconds: 120,
        memory: '512MiB',
    },
    async () => {
        const { cleanupStaleWhatsAppCalls } = require('./WhatsApp/whatsAppCallController')
        await cleanupStaleWhatsAppCalls()
    }
)

// WHATSAPP INBOUND QUEUE PROCESSOR - Async processing for inbound webhook items
exports.processWhatsAppInboundQueueItemSecondGen = onDocumentCreated(
    {
        document: 'whatsAppInboundQueue/{userId}/items/{messageSid}',
        timeoutSeconds: 540,
        memory: '1GiB',
        region: 'europe-west1',
    },
    async event => {
        const { processWhatsAppInboundQueueItem } = require('./WhatsApp/whatsAppInboundQueueProcessor')
        await processWhatsAppInboundQueueItem(event)
    }
)

exports.annaEmailIncomingMessage = onRequest(
    {
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async (req, res) => {
        const { handleIncomingAnnaEmail } = require('./Email/emailIncomingHandler')
        await handleIncomingAnnaEmail(req, res)
    }
)

exports.processAnnaEmailInboundQueueItemSecondGen = onDocumentCreated(
    {
        document: 'annaEmailInboundQueue/{userId}/items/{messageId}',
        timeoutSeconds: 540,
        memory: '2GiB',
        region: 'europe-west1',
    },
    async event => {
        const { processAnnaEmailInboundQueueItem } = require('./Email/emailInboundQueueProcessor')
        await processAnnaEmailInboundQueueItem(event)
    }
)
