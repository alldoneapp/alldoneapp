const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const { getEnvironmentConfig } = require('./config/environments.js')

// Helper function to get the correct base URL based on environment
function getBaseUrl() {
    const normalizeBaseUrl = url => {
        if (!url) return null
        const trimmed = url.trim()
        if (!trimmed) return null
        return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
    }

    // Honour explicit MCP base URL first (supports custom domains and direct CF endpoints)
    const envBaseUrl = normalizeBaseUrl(process.env.MCP_BASE_URL)
    if (envBaseUrl) {
        return envBaseUrl
    }

    try {
        const configBaseUrl = normalizeBaseUrl(getEnvironmentConfig()?.mcpBaseUrl)
        if (configBaseUrl) {
            return configBaseUrl
        }
    } catch (error) {
        console.warn('MCP getBaseUrl: failed to read environment config', error?.message)
    }

    if (process.env.FUNCTIONS_EMULATOR) {
        return 'http://localhost:5000'
    }

    // Prefer deriving environment from the Functions runtime project ID to avoid CI param reliance
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }
    if (!projectId) {
        try {
            projectId = (admin.app() && admin.app().options && admin.app().options.projectId) || undefined
        } catch (_) {}
    }

    // Temporary debug log to diagnose environment selection for base URL
    console.log('MCP getBaseUrl debug', {
        FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
        CURRENT_ENVIORNMENT: process.env.CURRENT_ENVIORNMENT,
        CURRENT_ENVIRONMENT: process.env.CURRENT_ENVIRONMENT,
        GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
        GCP_PROJECT: process.env.GCP_PROJECT,
        FIREBASE_CONFIG_hasProjectId: (() => {
            try {
                const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
                return !!(cfg && cfg.projectId)
            } catch (e) {
                return false
            }
        })(),
        detectedProjectId: projectId,
    })

    // Decide by detected projectId; default to production if unknown
    if (projectId === 'alldonealeph') {
        return 'https://my.alldone.app'
    }
    if (projectId === 'alldonestaging') {
        return 'https://mystaging.alldone.app'
    }

    return 'https://my.alldone.app'
}

// Note: Firebase admin is already initialized by main functions/index.js
// We'll use the existing admin instance directly

const { CloudOAuthHandler, CloudSessionManager, UserSessionManager } = require('./auth/cloudOAuth.js')

// Import Alldone constants (still needed for other operations)
const { OPEN_STEP, FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

/**
 * Rate Limiter using Firestore for persistence
 * Supports multiple time windows and different limits per operation
 */
class RateLimiter {
    constructor(firestore) {
        this.db = firestore
        this.collection = 'rateLimits'
    }

    /**
     * Check if request is within rate limit
     * @param {string} key - Rate limit key (e.g., "client:clientId" or "user:userId")
     * @param {number} limit - Maximum requests allowed
     * @param {number} windowMs - Time window in milliseconds
     * @param {string} operation - Operation type for logging
     * @returns {Promise<{allowed: boolean, remaining: number, resetTime: Date}>}
     */
    async checkLimit(key, limit, windowMs, operation = 'request') {
        const now = new Date()
        const windowStart = new Date(now.getTime() - windowMs)
        const docId = `${key}:${Math.floor(now.getTime() / windowMs)}`

        console.log(`🚦 Rate limit check: ${operation} for ${key} (limit: ${limit}/${windowMs}ms)`)

        try {
            const doc = await this.db.collection(this.collection).doc(docId).get()

            let currentCount = 0
            let firstRequest = now

            if (doc.exists) {
                const data = doc.data()
                currentCount = data.count || 0
                firstRequest = data.firstRequest?.toDate() || now
            }

            const remaining = Math.max(0, limit - currentCount - 1)
            const resetTime = new Date(firstRequest.getTime() + windowMs)

            if (currentCount >= limit) {
                console.log(`❌ Rate limit exceeded: ${key} (${currentCount}/${limit} requests)`)
                return {
                    allowed: false,
                    remaining: 0,
                    resetTime: resetTime,
                    current: currentCount,
                }
            }

            // Increment counter
            await this.db
                .collection(this.collection)
                .doc(docId)
                .set(
                    {
                        key: key,
                        count: currentCount + 1,
                        firstRequest: doc.exists
                            ? admin.firestore.Timestamp.fromDate(firstRequest)
                            : admin.firestore.Timestamp.now(),
                        lastRequest: admin.firestore.Timestamp.now(),
                        operation: operation,
                        expiresAt: admin.firestore.Timestamp.fromDate(resetTime),
                    },
                    { merge: true }
                )

            console.log(`✅ Rate limit OK: ${key} (${currentCount + 1}/${limit} requests, ${remaining} remaining)`)

            return {
                allowed: true,
                remaining: remaining,
                resetTime: resetTime,
                current: currentCount + 1,
            }
        } catch (error) {
            console.error(`❌ Rate limit check failed for ${key}:`, error.message)
            // Fail open - allow request if rate limiting fails
            return {
                allowed: true,
                remaining: limit - 1,
                resetTime: new Date(now.getTime() + windowMs),
                current: 0,
            }
        }
    }

    /**
     * Check multiple rate limits (e.g., per-client and per-user)
     * @param {Array} checks - Array of {key, limit, windowMs, operation} objects
     * @returns {Promise<{allowed: boolean, details: Array}>}
     */
    async checkMultipleLimits(checks) {
        const results = await Promise.all(
            checks.map(check => this.checkLimit(check.key, check.limit, check.windowMs, check.operation))
        )

        const allowed = results.every(result => result.allowed)
        const blockedBy = results.find(result => !result.allowed)

        return {
            allowed,
            details: results,
            blockedBy: blockedBy ? blockedBy : null,
        }
    }

    /**
     * Clean up expired rate limit records
     */
    async cleanup() {
        try {
            const now = admin.firestore.Timestamp.now()
            const expiredQuery = this.db.collection(this.collection).where('expiresAt', '<', now).limit(100)

            const expiredDocs = await expiredQuery.get()

            if (expiredDocs.empty) {
                console.log('🧹 Rate limit cleanup: No expired records found')
                return
            }

            const batch = this.db.batch()
            expiredDocs.forEach(doc => {
                batch.delete(doc.ref)
            })

            await batch.commit()
            console.log(`🧹 Rate limit cleanup: Deleted ${expiredDocs.size} expired records`)
        } catch (error) {
            console.error('❌ Rate limit cleanup failed:', error.message)
        }
    }
}

/**
 * Rate limiting configuration
 */
const RATE_LIMITS = {
    // OAuth endpoints
    CLIENT_REGISTER: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 registrations per hour
    CLIENT_AUTHORIZE: { limit: 100, windowMs: 60 * 60 * 1000 }, // 100 auth attempts per hour
    CLIENT_TOKEN: { limit: 200, windowMs: 60 * 60 * 1000 }, // 200 token requests per hour

    // MCP operations
    TOOL_CALLS: { limit: 1000, windowMs: 60 * 60 * 1000 }, // 1000 tool calls per hour
    TOOL_CALLS_MINUTE: { limit: 60, windowMs: 60 * 1000 }, // 60 tool calls per minute

    // User-specific limits (when authenticated)
    USER_OPERATIONS: { limit: 2000, windowMs: 60 * 60 * 1000 }, // 2000 operations per hour per user
    USER_OPERATIONS_MINUTE: { limit: 120, windowMs: 60 * 1000 }, // 120 operations per minute per user
}

class AlldoneSimpleMCPServer {
    constructor() {
        this.oauthHandler = new CloudOAuthHandler()
        this.sessionManager = new CloudSessionManager()
        this.userSessionManager = new UserSessionManager()
        // Store authentication state per client connection
        this.clientAuthentication = new Map() // clientId -> { userId, sessionId, timestamp }
        // Initialize rate limiter
        this.rateLimiter = new RateLimiter(admin.firestore())
        // MCP initialization state tracking per client session
        this.clientSessions = new Map() // sessionId -> { initialized, capabilities, clientInfo, timestamp }

        // Schedule periodic cleanup of expired rate limit records
        this.scheduleRateLimitCleanup()

        // Schedule periodic cleanup of expired client sessions
        this.scheduleSessionCleanup()
    }

    /**
     * Schedule periodic cleanup of expired rate limit records
     */
    scheduleRateLimitCleanup() {
        // In Firebase Cloud Functions, we can't use setInterval reliably
        // Instead, we'll trigger cleanup on server initialization and occasionally during requests
        console.log('🧹 Scheduling rate limit cleanup...')

        // Immediate cleanup on startup
        setTimeout(() => this.rateLimiter.cleanup(), 1000)

        // Track cleanup calls to avoid too frequent cleanups
        this.lastCleanup = 0
        this.cleanupCounter = 0

        // Note: For production, consider using Firebase Scheduled Functions for regular cleanup
        // https://firebase.google.com/docs/functions/schedule-functions
    }

    /**
     * Trigger cleanup occasionally during normal operations
     */
    async triggerPeriodicCleanup() {
        const now = Date.now()
        const CLEANUP_INTERVAL = 10 * 60 * 1000 // 10 minutes
        const CLEANUP_FREQUENCY = 100 // Every 100 requests

        this.cleanupCounter++

        // Trigger cleanup based on time interval or request frequency
        if (now - this.lastCleanup > CLEANUP_INTERVAL || this.cleanupCounter >= CLEANUP_FREQUENCY) {
            console.log('🧹 Triggering periodic rate limit cleanup...')
            this.lastCleanup = now
            this.cleanupCounter = 0

            // Run cleanup in background (don't await)
            this.rateLimiter.cleanup().catch(error => {
                console.error('❌ Background cleanup failed:', error.message)
            })
        }
    }

    /**
     * Schedule cleanup of expired client sessions
     */
    scheduleSessionCleanup() {
        console.log('🧹 Scheduling MCP client session cleanup...')

        // Initial cleanup
        setTimeout(() => this.cleanupExpiredSessions(), 5000)

        // Track session cleanup
        this.lastSessionCleanup = 0
        this.sessionCleanupCounter = 0
    }

    /**
     * Clean up expired MCP client sessions
     */
    async cleanupExpiredSessions() {
        try {
            const now = Date.now()
            const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes

            let cleaned = 0
            for (const [sessionId, session] of this.clientSessions.entries()) {
                if (now - session.timestamp > SESSION_TIMEOUT) {
                    this.clientSessions.delete(sessionId)
                    cleaned++
                }
            }

            if (cleaned > 0) {
                console.log(`🧹 MCP session cleanup: Removed ${cleaned} expired sessions`)
            }
        } catch (error) {
            console.error('❌ MCP session cleanup failed:', error.message)
        }
    }

    /**
     * Get or create MCP session for client
     */
    getOrCreateMCPSession(httpReq) {
        // Use a combination of IP and User-Agent as session identifier for HTTP transport
        const sessionId = `http_${httpReq.ip || 'unknown'}_${Buffer.from(httpReq.headers['user-agent'] || 'unknown')
            .toString('base64')
            .substring(0, 16)}`

        if (!this.clientSessions.has(sessionId)) {
            this.clientSessions.set(sessionId, {
                initialized: false,
                capabilities: null,
                clientInfo: null,
                timestamp: Date.now(),
            })
        }

        return sessionId
    }

    /**
     * Check rate limits for a request
     * @param {Object} req - Request object
     * @param {string} operation - Operation type
     * @param {string|null} userId - User ID if authenticated
     * @returns {Promise<{allowed: boolean, errorResponse?: Object}>}
     */
    async checkRateLimits(req, operation, userId = null) {
        const clientId = this.getClientIdFromRequest(req)
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'

        const checks = []

        // Get rate limit config for operation
        const config = RATE_LIMITS[operation]
        if (!config) {
            console.log(`⚠️ No rate limit config for operation: ${operation}`)
            return { allowed: true }
        }

        // Client-based rate limiting
        if (clientId) {
            checks.push({
                key: `client:${clientId}`,
                limit: config.limit,
                windowMs: config.windowMs,
                operation: `${operation}:client`,
            })
        }

        // IP-based rate limiting (fallback)
        checks.push({
            key: `ip:${ip}`,
            limit: config.limit * 2, // More lenient for IP-based limiting
            windowMs: config.windowMs,
            operation: `${operation}:ip`,
        })

        // User-based rate limiting (if authenticated)
        if (userId) {
            const userConfig = RATE_LIMITS.USER_OPERATIONS
            const userConfigMinute = RATE_LIMITS.USER_OPERATIONS_MINUTE

            checks.push({
                key: `user:${userId}`,
                limit: userConfig.limit,
                windowMs: userConfig.windowMs,
                operation: `${operation}:user:hour`,
            })

            checks.push({
                key: `user:${userId}:minute`,
                limit: userConfigMinute.limit,
                windowMs: userConfigMinute.windowMs,
                operation: `${operation}:user:minute`,
            })
        }

        // Tool-specific minute limiting for high-frequency operations
        if (operation === 'TOOL_CALLS') {
            const minuteConfig = RATE_LIMITS.TOOL_CALLS_MINUTE
            if (clientId) {
                checks.push({
                    key: `client:${clientId}:minute`,
                    limit: minuteConfig.limit,
                    windowMs: minuteConfig.windowMs,
                    operation: `${operation}:client:minute`,
                })
            }
        }

        try {
            const result = await this.rateLimiter.checkMultipleLimits(checks)

            // Trigger periodic cleanup
            await this.triggerPeriodicCleanup()

            if (!result.allowed) {
                console.log(`🚫 Rate limit exceeded for ${operation}:`, result.blockedBy)
                return {
                    allowed: false,
                    errorResponse: {
                        jsonrpc: '2.0',
                        error: {
                            code: -32000, // Server error
                            message: 'Rate limit exceeded',
                            data: {
                                operation: operation,
                                resetTime: result.blockedBy.resetTime,
                                remaining: result.blockedBy.remaining,
                            },
                        },
                    },
                }
            }

            return { allowed: true }
        } catch (error) {
            console.error(`❌ Rate limit check failed for ${operation}:`, error.message)
            // Fail open - allow request if rate limiting fails
            return { allowed: true }
        }
    }

    /**
     * Extract client ID from request for rate limiting
     */
    getClientIdFromRequest(req) {
        // Try to get client_id from various sources
        if (req.query?.client_id) return req.query.client_id
        if (req.body?.client_id) return req.body.client_id

        // Extract from OAuth Authorization header
        const authHeader = req.headers?.authorization
        if (authHeader?.startsWith('Bearer ')) {
            // For Bearer tokens, we'll use the token itself as identifier
            return authHeader.substring(7, 50) // First 43 chars for uniqueness
        }

        return null
    }

    // Authentication methods

    // Helper method to get user from Firebase ID token or OAuth access token
    async getAuthenticatedUserFromToken(accessToken) {
        if (!accessToken) {
            throw new Error('Access token is required')
        }

        try {
            // First, try to verify as Firebase ID token
            const decodedToken = await admin.auth().verifyIdToken(accessToken)
            return decodedToken.uid
        } catch (firebaseError) {
            // If Firebase ID token verification fails, try OAuth token lookup
            try {
                const db = admin.firestore()
                const tokenDoc = await db.collection('oauthTokens').doc(accessToken).get()

                if (!tokenDoc.exists) {
                    // For direct-login users, provide renewal link since token might have expired and been cleaned up
                    throw new Error(
                        `Invalid or expired access token. If you're using direct login, renew your token at: ${getBaseUrl()}/mcpServer/get-token`
                    )
                }

                const tokenData = tokenDoc.data()

                // Check token expiration
                if (tokenData.expiresAt.toDate() < new Date()) {
                    // Cleanup expired tokens when we encounter them
                    this.cleanupExpiredTokens().catch(console.error)

                    // Provide helpful renewal info for direct-login tokens
                    if (tokenData.grantType === 'direct-login') {
                        throw new Error(
                            `Access token has expired. To renew your token, visit: ${getBaseUrl()}/mcpServer/get-token`
                        )
                    } else {
                        throw new Error('Access token has expired')
                    }
                }

                // Validate token has userId, except for client_credentials which may use service user
                if (!tokenData.userId) {
                    if (tokenData.grantType === 'client_credentials') {
                        throw new Error(
                            'Client credentials token requires a configured service user ID (MCP_DEFAULT_USER_ID)'
                        )
                    } else {
                        throw new Error('Token does not have an associated user ID')
                    }
                }

                return tokenData.userId
            } catch (oauthError) {
                console.error('Token verification failed:', {
                    firebaseError: firebaseError.message,
                    oauthError: oauthError.message,
                })
                throw new Error('Invalid or expired token')
            }
        }
    }

    async createTask(args, request) {
        const { name, description, dueDate, projectId: specifiedProjectId } = args

        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)

        // Use specified project or fall back to user's default project
        const projectId = specifiedProjectId || (await this.getUserDefaultProject(userId))
        if (!projectId) {
            throw new Error(
                'No project specified and no default project found. Please specify a projectId or set a default project.'
            )
        }

        const db = admin.firestore()

        // Get user data for feed creation using shared helper
        const { UserHelper } = require('../shared/UserHelper')
        const feedUser = await UserHelper.getFeedUserData(db, userId)

        // Initialize TaskService if not already done
        if (!this.taskService) {
            const { TaskService } = require('../shared/TaskService')
            this.taskService = new TaskService({
                database: db,
                moment: moment,
                idGenerator: () => db.collection('_').doc().id,
                enableFeeds: true,
                enableValidation: true,
                isCloudFunction: true,
            })
            await this.taskService.initialize()
        }

        try {
            // Create task using unified service
            const result = await this.taskService.createAndPersistTask(
                {
                    name,
                    description,
                    dueDate,
                    userId,
                    projectId,
                    isPrivate: false, // Default to public for MCP-created tasks
                    feedUser,
                },
                {
                    userId,
                    projectId,
                    // We could add project permission validation here
                }
            )

            return {
                success: result.success,
                taskId: result.taskId,
                message: result.message,
                task: result.task,
            }
        } catch (error) {
            console.error('Error creating task:', error)
            throw new Error(`Failed to create task: ${error.message}`)
        }
    }

    async updateTask(args, request) {
        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)
        const db = admin.firestore()

        // Initialize TaskUpdateService if not already done
        if (!this.taskUpdateService) {
            const TaskUpdateService = require('../shared/TaskUpdateService')
            this.taskUpdateService = new TaskUpdateService({
                database: db,
                moment: moment,
                isCloudFunction: true,
            })
            await this.taskUpdateService.initialize()
        }

        // Use shared service for find and update
        return await this.taskUpdateService.findAndUpdateTask(
            userId,
            args, // searchCriteria
            args, // updateFields
            {
                autoSelectOnHighConfidence: true,
                highConfidenceThreshold: 800,
                dominanceMargin: 300,
                maxOptionsToShow: 5,
            }
        )
    }

    async getTasks(args, request) {
        const {
            projectId: specifiedProjectId,
            allProjects = false,
            includeArchived = false,
            includeCommunity = false,
            status = 'open',

            date,
            includeSubtasks = false,
            parentId = null,
        } = args

        // Get authenticated user from header
        const userId = await this.getAuthenticatedUserForClient(request)
        const db = admin.firestore()

        // Initialize TaskRetrievalService if not already done
        if (!this.taskRetrievalService) {
            const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
            this.taskRetrievalService = new TaskRetrievalService({
                database: db,
                moment: moment,
                isCloudFunction: true,
            })
            await this.taskRetrievalService.initialize()
        }

        const TaskRetrievalServiceClass = this.taskRetrievalService.constructor

        try {
            if (allProjects) {
                console.log(`🌐 Cross-project task query for user ${userId}`, {
                    includeArchived,
                    includeCommunity,
                    status,
                })

                // Get user data for timezone
                const userDoc = await db.collection('users').doc(userId).get()
                if (!userDoc.exists) {
                    throw new Error('User not found')
                }

                const userData = userDoc.data()
                const timezoneOffset = TaskRetrievalServiceClass.normalizeTimezoneOffset(userData?.timezone)

                // Use shared ProjectService for consistent filtering
                if (!this.projectService) {
                    const { ProjectService } = require('../shared/ProjectService')
                    this.projectService = new ProjectService({ database: db })
                    await this.projectService.initialize()
                }

                const projects = await this.projectService.getUserProjects(userId, {
                    includeArchived,
                    includeCommunity,
                    activeOnly: true,
                })

                const accessibleProjectIds = projects.map(p => p.id)
                const projectsData = projects.reduce((acc, project) => {
                    acc[project.id] = { name: project.name, description: project.description }
                    return acc
                }, {})

                // Log project counts for debugging
                const regularCount = projects.filter(p => p.projectType === 'regular').length
                const archivedCount = projects.filter(p => p.projectType === 'archived').length
                const templateCount = projects.filter(p => p.projectType === 'template').length
                const guideCount = projects.filter(p => p.projectType === 'guide').length

                console.log(
                    `📊 Project filtering: ${regularCount} regular, ${archivedCount} archived, ${templateCount} template, ${guideCount} guide`
                )
                console.log(`🎯 Selected ${accessibleProjectIds.length} projects for query`)
                console.log(`🔐 ${accessibleProjectIds.length} projects accessible after permission check`)

                if (accessibleProjectIds.length === 0) {
                    return {
                        success: true,
                        tasks: [],
                        subtasksByParent: {},
                        count: 0,
                        totalAcrossProjects: 0,
                        projectSummary: {},
                        queriedProjects: [],
                        message: 'No projects match the specified criteria',
                        query: {
                            limit,
                            hasMore: false,
                        },
                        timezoneOffset,
                    }
                }

                // Read user's customization for per-project cap
                const numberTodayTasksSetting = userDoc.exists ? userDoc.data().numberTodayTasks : undefined
                const perProjectLimit = typeof numberTodayTasksSetting === 'number' ? numberTodayTasksSetting : 10

                // Use TaskRetrievalService multi-project method
                const result = await this.taskRetrievalService.getTasksFromMultipleProjects(
                    {
                        userId,
                        status,
                        date,
                        includeSubtasks,
                        parentId,

                        userPermissions: [FEED_PUBLIC_FOR_ALL, userId],
                        // Return only minimal fields for each task
                        selectMinimalFields: true,
                        perProjectLimit,
                        timezoneOffset,
                    },
                    accessibleProjectIds,
                    projectsData
                )

                return {
                    ...result,
                    crossProjectQuery: true,
                    projectFilters: {
                        includeArchived,
                        includeCommunity,
                        totalRegularProjects: regularCount,
                        totalArchivedProjects: archivedCount,
                        totalCommunityProjects: templateCount + guideCount,
                    },
                }
            } else {
                // Single project mode (existing behavior)
                const projectId = specifiedProjectId || (await this.getUserDefaultProject(userId))
                if (!projectId) {
                    throw new Error(
                        'No project specified and no default project found. Please specify a projectId or set a default project.'
                    )
                }

                const userDoc = await db.collection('users').doc(userId).get()
                const userData = userDoc.exists ? userDoc.data() : {}
                const timezoneOffset = TaskRetrievalServiceClass.normalizeTimezoneOffset(userData?.timezone)

                // Verify user has access to project
                const projectDoc = await db.collection('projects').doc(projectId).get()
                if (!projectDoc.exists) {
                    throw new Error('Project not found')
                }

                const projectData = projectDoc.data()
                const userIds = projectData.userIds || []
                if (!userIds.includes(userId)) {
                    throw new Error('User does not have access to this project')
                }

                // Read user's customization for per-project cap
                const numberTodayTasksSetting = userDoc.exists ? userDoc.data().numberTodayTasks : undefined
                const perProjectLimit = typeof numberTodayTasksSetting === 'number' ? numberTodayTasksSetting : 10

                // Use TaskRetrievalService to get tasks from single project
                const result = await this.taskRetrievalService.getTasksWithValidation({
                    projectId,
                    userId,
                    status,
                    date,
                    includeSubtasks,
                    parentId,

                    userPermissions: [FEED_PUBLIC_FOR_ALL, userId],
                    // Return only minimal fields for each task
                    selectMinimalFields: true,
                    perProjectLimit,
                    projectName: projectData.name,
                    timezoneOffset,
                })

                return {
                    ...result,
                    crossProjectQuery: false,
                }
            }
        } catch (error) {
            console.error('Error getting tasks:', error)
            throw new Error(`Failed to get tasks: ${error.message}`)
        }
    }

    async getUserProjects(args, request) {
        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)
        const { includeArchived = false, includeCommunity = false } = args

        const db = admin.firestore()

        try {
            console.log('Getting projects for userId:', userId, { includeArchived, includeCommunity })

            // Initialize and use shared ProjectService (active by default)
            if (!this.projectService) {
                const { ProjectService } = require('../shared/ProjectService')
                this.projectService = new ProjectService({ database: db })
                await this.projectService.initialize()
            }

            const projects = await this.projectService.getUserProjects(userId, {
                includeArchived,
                includeCommunity,
                activeOnly: true,
            })

            // Calculate project type counts from returned projects
            const regularCount = projects.filter(p => p.projectType === 'regular').length
            const archivedCount = projects.filter(p => p.projectType === 'archived').length
            const templateCount = projects.filter(p => p.projectType === 'template').length
            const guideCount = projects.filter(p => p.projectType === 'guide').length

            console.log(
                `📊 Project filtering: ${regularCount} regular, ${archivedCount} archived, ${templateCount} template, ${guideCount} guide`
            )
            console.log(`Found ${projects.length} accessible projects for user (active by default)`)

            return {
                success: true,
                projects: projects,
                count: projects.length,
                projectFilters: {
                    includeArchived,
                    includeCommunity,
                    totalRegularProjects: regularCount,
                    totalArchivedProjects: archivedCount,
                    totalCommunityProjects: templateCount + guideCount,
                },
            }
        } catch (error) {
            console.error('Error getting user projects:', error)
            throw new Error(`Failed to get projects: ${error.message}`)
        }
    }

    async deleteAuthenticationData(args, request) {
        // Get authenticated user from OAuth Bearer token
        const userId = await this.getAuthenticatedUserForClient(request)

        const db = admin.firestore()

        try {
            console.log('Deleting all authentication data for userId:', userId)

            // Get current access token from request to identify which tokens to revoke
            const authHeader = request.headers?.authorization
            const currentToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

            // Delete all OAuth access tokens for this user
            const accessTokensQuery = await db.collection('oauthTokens').where('userId', '==', userId).get()
            console.log(`Found ${accessTokensQuery.size} access tokens to delete`)

            // Delete all OAuth refresh tokens for this user
            const refreshTokensQuery = await db.collection('oauthRefreshTokens').where('userId', '==', userId).get()
            console.log(`Found ${refreshTokensQuery.size} refresh tokens to delete`)

            // Delete all MCP user sessions for this user
            const mcpSessionsQuery = await db.collection('mcpUserSessions').where('userId', '==', userId).get()
            console.log(`Found ${mcpSessionsQuery.size} MCP sessions to delete`)

            // Use batch operations for atomic deletion
            const batch = db.batch()

            accessTokensQuery.docs.forEach(doc => {
                batch.delete(doc.ref)
            })

            refreshTokensQuery.docs.forEach(doc => {
                batch.delete(doc.ref)
            })

            mcpSessionsQuery.docs.forEach(doc => {
                batch.delete(doc.ref)
            })

            await batch.commit()

            const totalDeleted = accessTokensQuery.size + refreshTokensQuery.size + mcpSessionsQuery.size

            return {
                success: true,
                message: 'All authentication data has been deleted',
                deletedTokensCount: accessTokensQuery.size,
                deletedRefreshTokensCount: refreshTokensQuery.size,
                deletedSessionsCount: mcpSessionsQuery.size,
                totalDeleted: totalDeleted,
                note:
                    'You will need to re-authenticate using the OAuth /authorize endpoint to continue using MCP tools',
            }
        } catch (error) {
            console.error('Error deleting authentication data:', error)
            throw new Error(`Failed to delete authentication data: ${error.message}`)
        }
    }

    async getCurrentUserInfo(args, request) {
        // Get authenticated user from OAuth Bearer token
        const userId = await this.getAuthenticatedUserForClient(request)

        const db = admin.firestore()

        try {
            console.log('Getting current user info for userId:', userId)

            // Get user profile from Firebase Auth
            let userRecord = null
            try {
                userRecord = await admin.auth().getUser(userId)
            } catch (authError) {
                console.log('Could not get Firebase Auth user record:', authError.message)
            }

            // Get user document from Firestore
            let userData = null
            try {
                const userDoc = await db.collection('users').doc(userId).get()
                if (userDoc.exists) {
                    userData = userDoc.data()
                }
            } catch (firestoreError) {
                console.log('Could not get Firestore user document:', firestoreError.message)
            }

            // Get current token information
            const authHeader = request.headers?.authorization
            const currentToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
            let tokenInfo = null

            if (currentToken) {
                try {
                    const tokenDoc = await db.collection('oauthTokens').doc(currentToken).get()
                    if (tokenDoc.exists) {
                        const tokenData = tokenDoc.data()
                        tokenInfo = {
                            clientId: tokenData.clientId,
                            scope: tokenData.scope,
                            createdAt: tokenData.createdAt?.toDate(),
                            expiresAt: tokenData.expiresAt?.toDate(),
                            isExpired: tokenData.expiresAt?.toDate() < new Date(),
                        }
                    }
                } catch (tokenError) {
                    console.log('Could not get token information:', tokenError.message)
                }
            }

            // Count active sessions and tokens
            const [accessTokens, refreshTokens, mcpSessions] = await Promise.all([
                db.collection('oauthTokens').where('userId', '==', userId).get(),
                db.collection('oauthRefreshTokens').where('userId', '==', userId).get(),
                db.collection('mcpUserSessions').where('userId', '==', userId).get(),
            ])

            return {
                success: true,
                userId: userId,
                profile: {
                    email: userRecord?.email || userData?.email || 'Unknown',
                    displayName: userRecord?.displayName || userData?.name || userData?.displayName || 'Unknown',
                    photoURL: userRecord?.photoURL || userData?.photoURL || null,
                    emailVerified: userRecord?.emailVerified || false,
                    createdAt: userRecord?.metadata?.creationTime || userData?.createdAt,
                },
                authentication: {
                    method: 'OAuth 2.0 Bearer Token',
                    currentToken: tokenInfo,
                    activeAccessTokens: accessTokens.size,
                    activeRefreshTokens: refreshTokens.size,
                    activeMcpSessions: mcpSessions.size,
                },
                permissions: {
                    availableTools: [
                        'create_task',
                        'create_note',
                        'search',
                        'get_note',
                        'get_tasks',
                        'get_focus_task',
                        'get_user_projects',
                        'delete_authentication_data',
                        'get_current_user_info',
                    ],
                },
            }
        } catch (error) {
            console.error('Error getting current user info:', error)
            throw new Error(`Failed to get user information: ${error.message}`)
        }
    }

    async getFocusTask(args, request) {
        const { projectId } = args

        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)
        const db = admin.firestore()

        // Initialize FocusTaskService if not already done
        if (!this.focusTaskService) {
            const { FocusTaskService } = require('../shared/FocusTaskService')
            this.focusTaskService = new FocusTaskService({
                database: db,
                moment: moment,
                isCloudFunction: true,
            })
            await this.focusTaskService.initialize()
        }

        try {
            // Get focus task (current or new)
            const result = await this.focusTaskService.getFocusTask(userId, projectId, { selectMinimalFields: true })

            return {
                success: result.success,
                focusTask: result.focusTask,
                wasNewTaskSet: result.wasNewTaskSet,
                message: result.message,
            }
        } catch (error) {
            console.error('Error getting focus task:', error)
            throw new Error(`Failed to get focus task: ${error.message}`)
        }
    }

    async createNote(args, request) {
        const { title, content, projectId: specifiedProjectId } = args

        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)

        // Use specified project or fall back to user's default project
        const projectId = specifiedProjectId || (await this.getUserDefaultProject(userId))
        if (!projectId) {
            throw new Error(
                'No project specified and no default project found. Please specify a projectId or set a default project.'
            )
        }

        const db = admin.firestore()

        // Get user data for feed creation using shared helper
        const { UserHelper } = require('../shared/UserHelper')
        const feedUser = await UserHelper.getFeedUserData(db, userId)

        // Initialize NoteService if not already done
        if (!this.noteService) {
            const { NoteService } = require('../shared/NoteService')
            this.noteService = new NoteService({
                database: db,
                moment: moment,
                idGenerator: () => db.collection('_').doc().id,
                enableFeeds: true,
                enableValidation: true,
                isCloudFunction: true,
            })
            await this.noteService.initialize()
        }

        try {
            // Create note using unified service
            const result = await this.noteService.createAndPersistNote(
                {
                    title,
                    content,
                    userId,
                    projectId,
                    isPrivate: false, // Default to public for MCP-created notes
                    feedUser,
                },
                {
                    userId,
                    projectId,
                    // We could add project permission validation here
                }
            )

            return {
                success: result.success,
                noteId: result.noteId,
                message: result.message,
                note: result.note,
            }
        } catch (error) {
            console.error('Error creating note:', error)
            throw new Error(`Failed to create note: ${error.message}`)
        }
    }

    async search(args, request) {
        const { query, type = 'all', projectId, dateRange } = args

        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)

        const db = admin.firestore()

        // Initialize SearchService if not already done
        if (!this.searchService) {
            const { SearchService } = require('../shared/SearchService')
            this.searchService = new SearchService({
                database: db,
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
            })
            await this.searchService.initialize()
        }

        try {
            // Execute search using unified service
            const result = await this.searchService.search(userId, {
                query,
                type,
                projectId,
                dateRange,
            })

            return {
                success: true,
                query: result.query,
                parsedQuery: result.parsedQuery,
                results: result.results,
                totalResults: result.totalResults,
                searchedProjects: result.searchedProjects,
                message:
                    result.totalResults > 0
                        ? `Found ${result.totalResults} results across ${result.searchedProjects.length} projects`
                        : 'No results found',
            }
        } catch (error) {
            console.error('Error performing search:', error)
            throw new Error(`Failed to perform search: ${error.message}`)
        }
    }

    async getNote(args, request) {
        const { noteId, projectId } = args

        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)

        const db = admin.firestore()

        // Initialize SearchService if not already done (for note content retrieval)
        if (!this.searchService) {
            const { SearchService } = require('../shared/SearchService')
            this.searchService = new SearchService({
                database: db,
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
            })
            await this.searchService.initialize()
        }

        try {
            // Get full note content using unified service
            const result = await this.searchService.getNote(userId, noteId, projectId)

            return {
                success: true,
                note: result,
                message: `Retrieved note "${result.title}" (${result.metadata.wordCount} words)`,
            }
        } catch (error) {
            console.error('Error getting note:', error)
            throw new Error(`Failed to get note: ${error.message}`)
        }
    }

    async updateNote(args, request) {
        const { content, title } = args

        // Get authenticated user automatically from client session
        const userId = await this.getAuthenticatedUserForClient(request)
        const db = admin.firestore()

        // Step 1: Note Discovery - get final result from SearchService
        const searchResult = await this.findTargetNoteForUpdate(
            {
                noteTitle: args.title,
                noteId: args.noteId,
                projectName: args.projectName,
                projectId: args.projectId,
            },
            userId,
            db
        )

        // Handle search failure
        if (!searchResult.success) {
            if (searchResult.error === 'NO_MATCHES') {
                throw new Error(searchResult.message)
            } else if (searchResult.error === 'MULTIPLE_MATCHES') {
                return {
                    success: false,
                    message: searchResult.message,
                    confidence: searchResult.confidence,
                    reasoning: searchResult.reasoning,
                    matches: searchResult.matches,
                    totalMatches: searchResult.totalMatches,
                }
            } else {
                throw new Error(searchResult.message)
            }
        }

        // Step 2: Note Update - proceed with selected note
        const updateResult = await this.performNoteUpdate(
            searchResult.selectedNote,
            searchResult.projectId,
            searchResult.projectName,
            {
                content,
                title,
            },
            userId,
            db
        )

        // Add search reasoning to the update result for transparency
        if (searchResult.isAutoSelected) {
            updateResult.searchInfo = {
                confidence: searchResult.confidence,
                reasoning: searchResult.reasoning,
                alternativeMatches: searchResult.alternativeMatches?.length || 0,
            }
            updateResult.message += ` (${searchResult.reasoning})`
        }

        return updateResult
    }

    /**
     * Find target note using enhanced search with confidence-based auto-selection
     */
    async findTargetNoteForUpdate(searchCriteria, userId, db) {
        // Initialize SearchService if not already done
        if (!this.searchService) {
            const { SearchService } = require('../shared/SearchService')
            this.searchService = new SearchService({
                database: db,
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
            })
            await this.searchService.initialize()
        }

        return await this.searchService.findNoteForUpdateWithResults(userId, searchCriteria)
    }

    /**
     * Perform the actual note update
     */
    async performNoteUpdate(currentNote, currentProjectId, currentProjectName, updateFields, userId, db) {
        const { content, title } = updateFields

        // Initialize NoteService for consistent update logic and feed generation
        if (!this.noteService) {
            const { NoteService } = require('../shared/NoteService')
            this.noteService = new NoteService({
                database: db,
                moment: moment,
                idGenerator: () => db.collection('_').doc().id,
                enableFeeds: true,
                enableValidation: false, // Skip validation since we already validated
                isCloudFunction: true,
            })
            await this.noteService.initialize()
        }

        // Get user data for feed creation using shared helper
        const { UserHelper } = require('../shared/UserHelper')
        const feedUser = await UserHelper.getFeedUserData(db, userId)

        try {
            console.log('MCP: Using NoteService for note update with feed generation')
            // Use NoteService for update with proper feed generation
            const result = await this.noteService.updateAndPersistNote({
                noteId: currentNote.id,
                projectId: currentProjectId,
                currentNote: currentNote,
                content: content,
                title: title,
                feedUser: feedUser,
            })

            console.log('Note updated via NoteService:', {
                noteId: currentNote.id,
                projectId: currentProjectId,
                changes: result.changes,
                feedGenerated: !!result.feedData,
                persisted: result.persisted,
            })

            // Build success message showing what changed
            const changes = result.changes || []
            let message = `Note "${currentNote.title || 'Untitled'}" updated successfully`
            if (changes.length > 0) {
                message += ` (${changes.join(', ')})`
            }
            message += ` in project "${currentProjectName}"`

            return {
                success: true,
                noteId: currentNote.id,
                message,
                note: result.updatedNote || { id: currentNote.id, ...currentNote },
                project: { id: currentProjectId, name: currentProjectName },
                changes: changes,
            }
        } catch (error) {
            console.error('NoteService update failed:', error)
            throw new Error(`Failed to update note: ${error.message}`)
        }
    }

    // Note: HTTP transport initialization state management removed
    // HTTP is stateless, so the MCP client handles initialization sequence

    // Email-based authentication is now handled by storeUserAuthByEmail in mcpOAuthCallback.js
    // Client identification methods are no longer needed with email-based authentication

    // Helper function to get user's default project
    async getUserDefaultProject(userId) {
        try {
            const db = admin.firestore()
            const userDoc = await db.collection('users').doc(userId).get()
            if (userDoc.exists) {
                return userDoc.data().defaultProjectId || null
            }
        } catch (error) {
            console.error('Error getting user default project:', error)
        }
        return null
    }

    // Generate HTML page for direct token login (simple browser-based flow)
    generateDirectLoginPage() {
        const config = getEnvironmentConfig()
        const firebaseConfig = config.firebaseWeb
        const baseUrl = getBaseUrl()

        return `
<!DOCTYPE html>
<html>
<head>
    <title>Alldone MCP - Get Access Token</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .logo {
            font-size: 2.5em;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 20px;
        }
        .button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.3s;
            margin: 10px;
        }
        .button:hover {
            background: #5a6fd8;
        }
        .button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 8px;
            text-align: left;
        }
        .success {
            background: #d4edda;
            border: 2px solid #28a745;
            color: #155724;
        }
        .error {
            background: #f8d7da;
            border: 2px solid #dc3545;
            color: #721c24;
        }
        .info-box {
            background: #e3f2fd;
            border: 2px solid #2196f3;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
        }
        .refresh-link {
            color: #667eea;
            text-decoration: none;
            font-weight: bold;
        }
        .refresh-link:hover {
            text-decoration: underline;
        }
    </style>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-auth-compat.js"></script>
</head>
<body>
    <div class="container">
        <div class="logo">🚀 Alldone MCP</div>
        <h2>Get Your Access Token</h2>
        <p>Sign in with your Alldone account to generate your MCP access token for API usage.</p>
        
        <button id="loginBtn" class="button">Sign in with Google</button>
        <div id="status"></div>
        
        <div class="info-box">
            <div style="font-weight: bold; margin-bottom: 8px;">ℹ️ How it works:</div>
            <ul style="margin: 0; padding-left: 20px;">
                <li>Click "Sign in with Google" above</li>
                <li>Your access token will be created automatically</li>
                <li>Use the token for MCP API requests</li>
                <li>Token expires in 30 days (come back here to renew)</li>
            </ul>
        </div>
    </div>

    <script>
        // Firebase configuration
        const firebaseConfig = ${JSON.stringify(firebaseConfig)};

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();

        const loginBtn = document.getElementById('loginBtn');
        const status = document.getElementById('status');

        function showStatus(message, type = 'success') {
            status.innerHTML = \`<div class="status \${type}">\${message}</div>\`;
        }

        loginBtn.addEventListener('click', async () => {
            try {
                loginBtn.disabled = true;
                loginBtn.textContent = 'Signing in...';
                
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.addScope('email');
                provider.addScope('profile');
                
                const result = await auth.signInWithPopup(provider);
                const user = result.user;
                const firebaseToken = await user.getIdToken();
                
                console.log('🔑 Firebase authentication successful');
                console.log('👤 User email:', user.email);
                
                // Send token creation request to backend
                loginBtn.textContent = 'Creating access token...';
                
                const response = await fetch('${baseUrl}/mcpServer/get-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        firebaseToken: firebaseToken,
                        email: user.email
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    const expiresAt = new Date(data.expiresAt).toLocaleString();
                    
                    showStatus(\`
                        <div style="font-weight: bold; color: #155724; margin-bottom: 12px;">
                            ✅ Authentication Successful!
                        </div>
                        <div style="margin-bottom: 8px;">
                            🎟️ Your MCP access token has been created and is ready to use.
                        </div>
                        <div style="margin-bottom: 12px;">
                            ⏰ Token expires at: <strong>\${expiresAt}</strong> (30 days)
                        </div>
                        <div style="margin-bottom: 8px;">
                            🔄 When your token expires after 30 days:
                        </div>
                        <div>
                            Simply visit this page again: <a href="${baseUrl}/mcpServer/get-token" class="refresh-link" target="_blank">${baseUrl}/mcpServer/get-token</a>
                        </div>
                        <div style="margin-top: 12px; font-size: 14px; color: #666;">
                            📝 Your access token is now available for MCP clients to use automatically.
                        </div>
                    \`, 'success');
                } else {
                    showStatus('❌ Token creation failed: ' + data.error, 'error');
                    loginBtn.disabled = false;
                    loginBtn.textContent = 'Sign in with Google';
                }
            } catch (error) {
                console.error('Authentication error:', error);
                showStatus('❌ Authentication failed: ' + error.message, 'error');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Sign in with Google';
            }
        });
    </script>
</body>
</html>`
    }

    // Handle direct token creation after Firebase authentication
    async handleDirectTokenCreation(req, res) {
        try {
            console.log('🎟️ === PROCESSING DIRECT TOKEN CREATION ===')
            const { firebaseToken, email } = req.body

            if (!firebaseToken || !email) {
                console.log('❌ Missing required parameters for direct token creation')
                return res.status(400).json({
                    success: false,
                    error: 'Missing firebaseToken or email parameter',
                })
            }

            // Verify the Firebase token
            console.log('🔑 Verifying Firebase token...')
            const decodedToken = await admin.auth().verifyIdToken(firebaseToken)
            const userId = decodedToken.uid
            console.log('✅ Firebase token verified for user:', userId)
            console.log('👤 User email from token:', decodedToken.email)

            if (decodedToken.email !== email) {
                console.log('❌ Email mismatch in token verification')
                return res.status(400).json({
                    success: false,
                    error: 'Email mismatch in token verification',
                })
            }

            // Ensure direct-login client exists
            const db = admin.firestore()
            const directLoginClientId = 'direct-login'

            console.log('🔍 Ensuring direct-login client exists...')
            const clientDoc = await db.collection('oauthClients').doc(directLoginClientId).get()

            if (!clientDoc.exists) {
                console.log('📝 Creating direct-login client registration...')
                const clientData = {
                    clientId: directLoginClientId,
                    clientSecret: 'direct-login-secret', // Fixed secret for direct login
                    createdAt: admin.firestore.Timestamp.now(),
                    redirectUris: [], // No redirects needed for direct login
                    grantTypes: ['direct-login'], // Custom grant type
                    scopes: ['read', 'write', 'mcp:tools'],
                    tokenEndpointAuthMethod: 'none',
                    autoRegistered: true,
                    directLogin: true, // Mark as direct login client
                }

                await db.collection('oauthClients').doc(directLoginClientId).set(clientData)
                console.log('✅ Direct-login client created successfully')
            } else {
                console.log('✅ Direct-login client already exists')
            }

            // Generate long-lived access token (30 days for direct login)
            console.log('🎫 Generating long-lived access token...')
            const accessToken = `mcp_access_${uuidv4()}`

            console.log('🆔 Generated access token:', accessToken.substring(0, 20) + '...')

            const now = admin.firestore.Timestamp.now()
            const accessExpiry = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 3600 * 1000)) // 30 days

            // Store access token (no refresh token needed for direct login)
            const accessTokenData = {
                accessToken,
                refreshToken: null, // No refresh token for direct login
                clientId: directLoginClientId,
                userId: userId,
                mcpSessionId: null, // Not needed for direct login
                scope: 'read write mcp:tools',
                grantType: 'direct-login',
                createdAt: now,
                expiresAt: accessExpiry,
            }

            console.log('💾 Storing access token in oauthTokens collection...')
            await db.collection('oauthTokens').doc(accessToken).set(accessTokenData)
            console.log('✅ Access token stored successfully')

            // Store user authentication mapping for cross-session access
            console.log('💾 Storing user authentication mapping...')
            const authData = {
                email,
                userId,
                accessToken, // Store current access token for lookup
                timestamp: now,
                expiresAt: accessExpiry, // 30-day expiry
            }

            await db.collection('mcpUserAuth').doc(email).set(authData)
            console.log('✅ User authentication mapping stored successfully')

            // Also store in mcpUserSessions for consistency with OAuth flow
            console.log('💾 Storing user session with MCP access token...')
            await db.collection('mcpUserSessions').doc(userId).set(
                {
                    userId: userId,
                    email: email,
                    bearerToken: accessToken, // Store MCP access token
                    sessionId: null, // No MCP session for direct login
                    createdAt: now,
                    expiresAt: accessExpiry,
                    lastUsed: now,
                },
                { merge: true }
            )
            console.log('✅ User session stored successfully')

            console.log('🎉 Direct token creation completed successfully:', {
                userId: userId,
                email: email,
                accessTokenCreated: true,
                authMappingCreated: true,
                expiresAt: accessExpiry.toDate(),
            })

            // Return success response (no tokens exposed)
            res.json({
                success: true,
                message: 'Access token created successfully',
                userId: userId,
                email: email,
                expiresAt: accessExpiry.toDate().toISOString(), // For UI display
                renewUrl: `${getBaseUrl()}/mcpServer/get-token`, // Point back to get-token for renewal
            })
        } catch (error) {
            console.error('❌ Error in direct token creation:', error)
            res.status(500).json({
                success: false,
                error: 'Token creation failed: ' + error.message,
            })
        }
    }

    // Cleanup expired tokens and auth sessions
    async cleanupExpiredTokens() {
        try {
            const db = admin.firestore()
            const now = admin.firestore.Timestamp.now()

            console.log('🧹 Starting comprehensive token cleanup...')

            // Clean up expired access tokens
            const expiredTokens = await db.collection('oauthTokens').where('expiresAt', '<', now).get()
            console.log(`🗑️ Found ${expiredTokens.size} expired access tokens`)

            // Clean up expired refresh tokens
            const expiredRefreshTokens = await db.collection('oauthRefreshTokens').where('expiresAt', '<', now).get()
            console.log(`🗑️ Found ${expiredRefreshTokens.size} expired refresh tokens`)

            // Clean up expired auth sessions
            const expiredSessions = await db.collection('oauthAuthSessions').where('expiresAt', '<', now).get()
            console.log(`🗑️ Found ${expiredSessions.size} expired auth sessions`)

            // Clean up orphaned access tokens (where refresh token no longer exists)
            const allAccessTokens = await db.collection('oauthTokens').where('refreshToken', '!=', null).get()

            const orphanedTokens = []
            for (const tokenDoc of allAccessTokens.docs) {
                const tokenData = tokenDoc.data()
                if (tokenData.refreshToken) {
                    const refreshDoc = await db.collection('oauthRefreshTokens').doc(tokenData.refreshToken).get()
                    if (!refreshDoc.exists) {
                        orphanedTokens.push(tokenDoc)
                        console.log(`🔗 Found orphaned access token: ${tokenDoc.id.substring(0, 20)}...`)
                    }
                }
            }
            console.log(`🔗 Found ${orphanedTokens.length} orphaned access tokens`)

            // Prepare all cleanup operations
            const cleanupOperations = [
                // Delete expired access tokens
                ...expiredTokens.docs.map(doc => doc.ref.delete()),
                // Delete expired refresh tokens
                ...expiredRefreshTokens.docs.map(doc => doc.ref.delete()),
                // Delete expired auth sessions
                ...expiredSessions.docs.map(doc => doc.ref.delete()),
                // Delete orphaned access tokens
                ...orphanedTokens.map(doc => doc.ref.delete()),
            ]

            // Clean up expired user sessions
            await this.userSessionManager.cleanupExpiredSessions()

            // Execute all cleanups in batches to avoid hitting Firestore limits
            const batchSize = 100 // Firestore batch limit is 500, we use 100 for safety
            for (let i = 0; i < cleanupOperations.length; i += batchSize) {
                const batch = cleanupOperations.slice(i, i + batchSize)
                await Promise.all(batch)
                console.log(
                    `🧹 Cleaned up batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
                        cleanupOperations.length / batchSize
                    )}`
                )
            }

            const totalCleaned =
                expiredTokens.size + expiredRefreshTokens.size + expiredSessions.size + orphanedTokens.length
            console.log(`✅ Token cleanup completed: ${totalCleaned} items cleaned up`, {
                expiredAccessTokens: expiredTokens.size,
                expiredRefreshTokens: expiredRefreshTokens.size,
                expiredAuthSessions: expiredSessions.size,
                orphanedAccessTokens: orphanedTokens.length,
            })
        } catch (error) {
            console.error('❌ Error during token cleanup:', error)
        }
    }

    // Get authenticated user for current client - OAuth Bearer tokens ONLY
    async getAuthenticatedUserForClient(req) {
        try {
            // OAuth Bearer token is the ONLY supported authentication method
            if (!req || !req.headers || !req.headers.authorization) {
                throw new Error('Authentication required. Please use OAuth flow to authenticate.')
            }

            const authHeader = req.headers.authorization
            if (!authHeader.startsWith('Bearer ')) {
                throw new Error('Authentication required. Bearer token must be provided via OAuth flow.')
            }

            const accessToken = authHeader.substring(7)
            const userId = await this.getAuthenticatedUserFromToken(accessToken)
            return userId
        } catch (error) {
            if (
                error.message.includes('Invalid or expired token') ||
                error.message.includes('Authentication required') ||
                error.message.includes('Bearer token')
            ) {
                throw error
            }
            console.error('OAuth authentication check failed:', error)
            throw new Error(
                'OAuth authentication failed. Please complete the OAuth flow using the /authorize endpoint.'
            )
        }
    }

    // HTTP Transport implementation (2025-03-26 spec)
    async handleHTTP(req, res) {
        try {
            if (req.method === 'GET') {
                // Return proper MCP server info as per transport specification
                res.set('Content-Type', 'application/json; charset=utf-8').json({
                    jsonrpc: '2.0',
                    id: null,
                    result: {
                        protocolVersion: '2025-03-26',
                        capabilities: {
                            tools: {
                                listChanged: true,
                            },
                            resources: {
                                listChanged: true,
                                subscribe: true,
                            },
                            prompts: {
                                listChanged: true,
                            },
                            logging: {},
                        },
                        serverInfo: {
                            name: 'alldone-mcp-server',
                            version: '1.0.0',
                        },
                        instructions:
                            'This is the Alldone MCP Server providing access to task management, project organization, and productivity tools. AUTHENTICATION REQUIRED: You must authenticate using OAuth 2.0 authorization code flow with PKCE. No alternative authentication methods are supported. Use the /authorize endpoint to begin the authentication process.',
                    },
                })
                return
            }

            if (req.method === 'POST') {
                // POST request - handle JSON-RPC messages
                // Validate Content-Type header as per MCP transport specification
                const contentType = req.headers['content-type']
                if (!contentType || !contentType.includes('application/json')) {
                    res.status(400)
                        .set('Content-Type', 'application/json; charset=utf-8')
                        .json({
                            jsonrpc: '2.0',
                            id: null,
                            error: {
                                code: -32600,
                                message: 'Invalid Request',
                                data: 'Content-Type must be application/json per MCP transport specification',
                            },
                        })
                    return
                }

                // Validate UTF-8 encoding (MCP requirement)
                if (contentType && !contentType.includes('charset=utf-8') && !contentType.includes('charset=UTF-8')) {
                    // Note: Many clients don't explicitly set charset, but we should encourage it
                    console.log('⚠️ Client did not specify UTF-8 charset, assuming UTF-8')
                }

                // Relax Accept header validation for compatibility with MCP clients (e.g., Claude Code)
                // Accept headers like */* or missing Accept are allowed. We'll only log if it's explicitly incompatible.
                const acceptHeader = req.headers['accept']
                if (
                    acceptHeader &&
                    acceptHeader !== '*/*' &&
                    !(acceptHeader.includes('application/json') || acceptHeader.includes('text/event-stream'))
                ) {
                    console.log('⚠️ Non-standard Accept header, proceeding anyway:', acceptHeader)
                }

                // Log Origin header for monitoring but allow all origins (to support all MCP clients)
                const originHeader = req.headers['origin']
                if (originHeader) {
                    console.log('📍 MCP request from origin:', originHeader)
                }

                if (!req.body) {
                    res.status(400).json({
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32600,
                            message: 'Invalid Request',
                            data: 'Request body required',
                        },
                    })
                    return
                }

                // Validate UTF-8 encoding and parse JSON as per MCP specification
                let parsedBody = req.body
                if (typeof parsedBody === 'string') {
                    try {
                        // Ensure UTF-8 encoding compliance
                        if (!Buffer.isEncoding('utf8')) {
                            throw new Error('Invalid encoding')
                        }
                        parsedBody = JSON.parse(parsedBody)
                    } catch (e) {
                        res.status(400).json({
                            jsonrpc: '2.0',
                            id: null,
                            error: {
                                code: -32700,
                                message: 'Parse error',
                                data: 'Invalid JSON or non-UTF-8 encoding',
                            },
                        })
                        return
                    }
                }

                // Handle JSON-RPC request(s)
                try {
                    const result = await this.processJsonRpcRequest(parsedBody, req)

                    if (result === null || result === undefined || (Array.isArray(result) && result.length === 0)) {
                        res.status(202).end()
                        return
                    }

                    // Return JSON response with proper MCP-compliant headers
                    res.set('Content-Type', 'application/json; charset=utf-8').json(result)
                    return
                } catch (authError) {
                    // Handle authentication errors as per MCP specification
                    if (authError.statusCode === 401) {
                        console.log('🔐 Returning HTTP 401 as required by MCP spec')
                        res.status(401)
                            .set(authError.headers || {})
                            .json(
                                authError.body || {
                                    error: 'unauthorized',
                                    error_description: 'Authentication required',
                                }
                            )
                        return
                    }
                    // Re-throw non-auth errors
                    throw authError
                }
            }

            res.status(405).json({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32601,
                    message: 'Method not allowed',
                    data: 'Only GET and POST methods are supported',
                },
            })
        } catch (error) {
            console.error('=== HTTP TRANSPORT ERROR ===')
            console.error('HTTP transport error:', error)
            console.error('Error stack:', error.stack)
            console.error('Request method:', req.method)
            console.error('Request path:', req.path)
            console.error('Request URL:', req.url)
            console.error('============================')
            res.status(500)
                .set('Content-Type', 'application/json; charset=utf-8')
                .json({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32603, message: 'Internal error', data: error.message },
                })
        }
    }

    // Process individual JSON-RPC requests with enhanced batch validation
    async processJsonRpcRequest(request, httpReq) {
        try {
            if (Array.isArray(request)) {
                // Enhanced batch request validation per MCP specification
                console.log(`📦 Processing JSON-RPC batch with ${request.length} requests`)

                if (request.length === 0) {
                    return {
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32600,
                            message: 'Invalid Request',
                            data: 'Batch request cannot be empty',
                        },
                    }
                }

                if (request.length > 50) {
                    // Reasonable batch size limit
                    return {
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32600,
                            message: 'Invalid Request',
                            data: 'Batch request too large (max 50 requests)',
                        },
                    }
                }

                // Validate that initialize is not part of batch
                const hasInitialize = request.some(req => req.method === 'initialize')
                if (hasInitialize) {
                    return {
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32600,
                            message: 'Invalid Request',
                            data: 'initialize request MUST NOT be part of a JSON-RPC batch',
                        },
                    }
                }

                // Validate each request has proper JSON-RPC structure
                for (let i = 0; i < request.length; i++) {
                    const req = request[i]
                    if (!req || typeof req !== 'object' || !req.jsonrpc || !req.method) {
                        return {
                            jsonrpc: '2.0',
                            id: req?.id || null,
                            error: {
                                code: -32600,
                                message: 'Invalid Request',
                                data: `Request at index ${i} is not a valid JSON-RPC request`,
                            },
                        }
                    }
                }

                const results = []
                const errors = []

                // Process requests sequentially to maintain order
                for (let i = 0; i < request.length; i++) {
                    const req = request[i]
                    try {
                        const result = await this.handleSingleJsonRpc(req, httpReq)
                        if (result !== undefined && result !== null) {
                            results.push(result)
                        }
                    } catch (batchError) {
                        console.error(`Batch request ${i} failed:`, batchError)
                        errors.push({
                            jsonrpc: '2.0',
                            id: req.id || null,
                            error: {
                                code: -32603,
                                message: 'Internal error',
                                data: `Batch request ${i}: ${batchError.message}`,
                            },
                        })
                    }
                }

                // Include errors in results for proper batch response
                const finalResults = [...results, ...errors]
                console.log(`📦 Batch complete: ${results.length} successful, ${errors.length} errors`)

                return finalResults.length > 0 ? finalResults : undefined
            } else {
                // Single request
                return await this.handleSingleJsonRpc(request, httpReq)
            }
        } catch (error) {
            // Check if this is an authentication error that should return HTTP 401
            if (error.statusCode === 401) {
                // Re-throw to be handled by the HTTP transport layer
                throw error
            }
            console.error('JSON-RPC processing error:', error)
            return {
                jsonrpc: '2.0',
                id: request?.id || null,
                error: { code: -32603, message: 'Internal error', data: error.message },
            }
        }
    }

    // Handle individual JSON-RPC messages
    async handleSingleJsonRpc(request, httpReq) {
        try {
            // Handle JSON-RPC notifications (no id field) - do not return a response
            const isNotification = typeof request.id === 'undefined' || request.id === null
            if (isNotification) {
                // Known notifications
                if (request.method === 'notifications/initialized') {
                    return undefined
                }
                // Unknown notifications: accept and no-op
                return undefined
            }

            // Note: For HTTP transport, we don't enforce initialization state tracking
            // since HTTP is stateless. The MCP client handles the initialization sequence.

            // Handle initialization
            if (request.method === 'initialize') {
                const sessionId = this.getOrCreateMCPSession(httpReq)
                const session = this.clientSessions.get(sessionId)

                const clientInfo = request.params?.clientInfo || {}
                const requestedVersion = request.params?.protocolVersion || '2025-03-26'
                const clientCapabilities = request.params?.capabilities || {}

                console.log('🔄 MCP Initialize:', {
                    sessionId: sessionId.substring(0, 20) + '...',
                    clientName: clientInfo.name || 'Unknown',
                    clientVersion: clientInfo.version || 'Unknown',
                    requestedVersion: requestedVersion,
                    clientCapabilities: Object.keys(clientCapabilities),
                })

                // Check authentication status - return HTTP 401 if not authenticated (per MCP spec)
                try {
                    await this.getAuthenticatedUserForClient(httpReq)
                } catch (error) {
                    // Not authenticated - return HTTP 401 as required by MCP authorization spec
                    console.log('🔐 MCP Initialize: Authentication required, returning HTTP 401')

                    const baseUrl = `${getBaseUrl()}/mcpServer`
                    console.log('🔗 MCP Initialize 401 baseUrl:', baseUrl)

                    // This should be handled at the HTTP transport level, not here
                    // But since we're in the JSON-RPC handler, we'll throw an error that the HTTP handler will catch
                    const authError = new Error('Authentication required')
                    authError.statusCode = 401
                    authError.headers = {
                        'WWW-Authenticate': `Bearer realm="mcp-server", error="invalid_token", error_description="Authentication required"`,
                        Link: `<${baseUrl}/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"`,
                        'Cache-Control': 'no-store',
                    }
                    authError.body = {
                        error: 'unauthorized',
                        error_description: 'Authentication required. Please authenticate via OAuth.',
                        authorization_endpoint: `${baseUrl}/authorize`,
                        instructions: [
                            '1. Visit the authorization endpoint to start OAuth flow',
                            '2. Complete authentication in browser',
                            '3. Use Bearer token in Authorization header for subsequent requests',
                        ],
                    }
                    throw authError
                }

                // Version negotiation: support 2025-03-26 or respond with our version
                const supportedVersions = ['2025-03-26']
                let negotiatedVersion
                if (supportedVersions.includes(requestedVersion)) {
                    negotiatedVersion = requestedVersion
                } else {
                    console.log(
                        `⚠️ Client requested unsupported version ${requestedVersion}, negotiating to ${
                            supportedVersions[supportedVersions.length - 1]
                        }`
                    )
                    negotiatedVersion = supportedVersions[supportedVersions.length - 1]
                }

                // Negotiate capabilities based on client support
                const serverCapabilities = {
                    tools: {
                        listChanged: true,
                    },
                    resources: {
                        listChanged: true,
                        subscribe: clientCapabilities.resources?.subscribe !== false, // Only if client supports it
                    },
                    prompts: {
                        listChanged: true,
                    },
                    logging: clientCapabilities.logging || {},
                }

                // Update session state
                session.initialized = true
                session.capabilities = serverCapabilities
                session.clientInfo = clientInfo
                session.timestamp = Date.now()

                const initializeResult = {
                    protocolVersion: negotiatedVersion,
                    capabilities: serverCapabilities,
                    serverInfo: {
                        name: 'alldone-mcp-server',
                        version: '1.0.0',
                    },
                    instructions:
                        'This is the Alldone MCP Server providing access to task management, project organization, and productivity tools. AUTHENTICATION REQUIRED: You must authenticate using OAuth 2.0 (authorization_code for users or client_credentials for services). Use the /authorize endpoint to begin the authentication process.',
                }

                console.log('✅ MCP Initialize complete:', {
                    sessionId: sessionId.substring(0, 20) + '...',
                    negotiatedVersion: negotiatedVersion,
                    serverCapabilities: Object.keys(serverCapabilities),
                })

                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: initializeResult,
                }
            }

            // Handle tools/list
            if (request.method === 'tools/list') {
                const tools = {
                    tools: [
                        {
                            name: 'create_task',
                            description:
                                'Create a new task in the current project (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string',
                                        description: 'Task name (required)',
                                    },
                                    description: {
                                        type: 'string',
                                        description: 'Task description (optional)',
                                    },
                                    dueDate: {
                                        type: 'number',
                                        description: 'Due date as timestamp (optional)',
                                    },
                                    projectId: {
                                        type: 'string',
                                        description: 'Project ID (optional, uses user default project if not provided)',
                                    },
                                },
                                required: ['name'],
                            },
                        },
                        {
                            name: 'update_task',
                            description:
                                'Update an existing task using flexible search criteria (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    taskId: {
                                        type: 'string',
                                        description: 'Task ID to update (optional, for direct lookup)',
                                    },
                                    taskName: {
                                        type: 'string',
                                        description: 'Full or partial task name to search (optional)',
                                    },
                                    projectName: {
                                        type: 'string',
                                        description: 'Full or partial project name to search (optional)',
                                    },
                                    projectId: {
                                        type: 'string',
                                        description: 'Project ID to search within (optional)',
                                    },
                                    name: {
                                        type: 'string',
                                        description: 'New task name (optional)',
                                    },
                                    description: {
                                        type: 'string',
                                        description: 'New task description (optional)',
                                    },
                                    dueDate: {
                                        type: 'number',
                                        description: 'New due date as timestamp (optional)',
                                    },
                                    completed: {
                                        type: 'boolean',
                                        description: 'Mark task as complete/incomplete (optional)',
                                    },
                                    parentId: {
                                        type: 'string',
                                        description:
                                            'Set parent task ID for subtasks (optional, null to remove parent)',
                                    },
                                    userId: {
                                        type: 'string',
                                        description: 'Reassign task to different user (optional)',
                                    },
                                    focus: {
                                        type: 'boolean',
                                        description:
                                            'Set to true to mark this task as your focus task, or false to clear it (optional)',
                                    },
                                },
                                required: [],
                            },
                        },
                        {
                            name: 'create_note',
                            description:
                                'Create a new note in the current project (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    title: {
                                        type: 'string',
                                        description: 'Note title (required)',
                                    },
                                    content: {
                                        type: 'string',
                                        description:
                                            'Note content (optional, supports markdown formatting like # headers, **bold**, *italic*, lists, etc. Will create default template if not provided)',
                                    },
                                    projectId: {
                                        type: 'string',
                                        description: 'Project ID (optional, uses user default project if not provided)',
                                    },
                                },
                                required: ['title'],
                            },
                        },
                        {
                            name: 'search',
                            description:
                                'Search across all content types with natural language queries (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    query: {
                                        type: 'string',
                                        description:
                                            'Search query (supports natural language, e.g., "What did I discuss last week with John about the project?")',
                                    },
                                    type: {
                                        type: 'string',
                                        enum: ['all', 'tasks', 'notes', 'goals', 'contacts', 'chats', 'assistants'],
                                        description: 'Content type to search (default: all)',
                                    },
                                    projectId: {
                                        type: 'string',
                                        description: 'Limit search to specific project (optional)',
                                    },
                                    dateRange: {
                                        type: 'string',
                                        description:
                                            'Time filter (e.g., "last week", "yesterday", "this month") (optional)',
                                    },
                                },
                                required: ['query'],
                            },
                        },
                        {
                            name: 'get_note',
                            description:
                                'Get full note content for detailed reading (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    noteId: {
                                        type: 'string',
                                        description: 'Note ID to retrieve',
                                    },
                                    projectId: {
                                        type: 'string',
                                        description: 'Project ID containing the note',
                                    },
                                },
                                required: ['noteId', 'projectId'],
                            },
                        },
                        {
                            name: 'update_note',
                            description:
                                'Update an existing note by prepending new content with a date stamp (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    noteId: {
                                        type: 'string',
                                        description: 'Note ID to update (optional, for direct lookup)',
                                    },
                                    noteTitle: {
                                        type: 'string',
                                        description: 'Full or partial note title to search (optional)',
                                    },
                                    projectName: {
                                        type: 'string',
                                        description: 'Full or partial project name to search (optional)',
                                    },
                                    projectId: {
                                        type: 'string',
                                        description: 'Project ID to search within (optional)',
                                    },
                                    content: {
                                        type: 'string',
                                        description: 'New content to prepend to the note with date stamp (required)',
                                    },
                                    title: {
                                        type: 'string',
                                        description: 'Update the note title (optional)',
                                    },
                                },
                                required: ['content'],
                            },
                        },
                        {
                            name: 'get_tasks',
                            description:
                                'Get tasks from a project with advanced filtering and subtask support (requires authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    projectId: {
                                        type: 'string',
                                        description: 'Project ID (optional, uses user default project if not provided)',
                                    },
                                    allProjects: {
                                        type: 'boolean',
                                        description:
                                            'Get tasks from all accessible projects (default: false). When true, ignores projectId parameter.',
                                    },
                                    includeArchived: {
                                        type: 'boolean',
                                        description:
                                            'Include archived projects when using allProjects (default: false)',
                                    },
                                    includeCommunity: {
                                        type: 'boolean',
                                        description:
                                            'Include community/template/guide projects when using allProjects (default: false)',
                                    },
                                    status: {
                                        type: 'string',
                                        enum: ['open', 'done', 'all'],
                                        description: 'Task status filter (default: open)',
                                    },
                                    date: {
                                        type: 'string',
                                        description:
                                            'Date filter in YYYY-MM-DD format or relative keywords like "today", "yesterday", "tomorrow", "this_week", "last_week", "last 7 days", or "next 7 days". For open tasks: filters due dates ("today" also includes overdue). For done tasks: filters completion dates. Default: "today".',
                                    },
                                    includeSubtasks: {
                                        type: 'boolean',
                                        description: 'Include subtasks in results (default: false)',
                                    },
                                    parentId: {
                                        type: 'string',
                                        description:
                                            'Get subtasks for specific parent task ID (requires includeSubtasks: true)',
                                    },
                                },
                                required: [],
                            },
                        },
                        {
                            name: 'get_user_projects',
                            description:
                                'Get list of projects accessible to authenticated user (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    includeArchived: {
                                        type: 'boolean',
                                        description: 'Include archived projects (default: false)',
                                    },
                                    includeCommunity: {
                                        type: 'boolean',
                                        description: 'Include community/template/guide projects (default: false)',
                                    },
                                },
                                required: [],
                            },
                        },
                        {
                            name: 'get_focus_task',
                            description:
                                'Get the current focus task for the user, or find and set a new one if none exists (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    projectId: {
                                        type: 'string',
                                        description: 'Project context for finding new focus task (optional)',
                                    },
                                },
                                required: [],
                            },
                        },
                        {
                            name: 'delete_authentication_data',
                            description:
                                'Delete all OAuth 2.0 authentication data for the current user (revokes all Bearer tokens and sessions)',
                            inputSchema: {
                                type: 'object',
                                properties: {},
                                required: [],
                            },
                        },
                        {
                            name: 'get_current_user_info',
                            description:
                                'Get information about the currently authenticated user (requires OAuth 2.0 Bearer token authentication)',
                            inputSchema: {
                                type: 'object',
                                properties: {},
                                required: [],
                            },
                        },
                    ],
                }
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: tools,
                }
            }

            // Handle prompts/list (return empty for now)
            if (request.method === 'prompts/list') {
                const prompts = { prompts: [] }
                return { jsonrpc: '2.0', id: request.id, result: prompts }
            }

            // Handle tools/call
            if (request.method === 'tools/call') {
                const { name, arguments: args } = request.params

                // Check rate limits for tool calls - all tools require authentication
                let userId = null
                try {
                    userId = await this.getAuthenticatedUserForClient(httpReq)
                } catch (error) {
                    // Authentication will be handled by individual tool methods
                }
                const rateLimitCheck = await this.checkRateLimits(httpReq, 'TOOL_CALLS', userId)
                if (!rateLimitCheck.allowed) {
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32000,
                            message: 'Rate limit exceeded',
                            data: {
                                tool: name,
                                resetTime: rateLimitCheck.errorResponse.error.data.resetTime,
                                remaining: rateLimitCheck.errorResponse.error.data.remaining,
                            },
                        },
                    }
                }

                try {
                    let result
                    switch (name) {
                        case 'create_task':
                            result = await this.createTask(args, httpReq)
                            break
                        case 'update_task':
                            result = await this.updateTask(args, httpReq)
                            break
                        case 'create_note':
                            result = await this.createNote(args, httpReq)
                            break
                        case 'search':
                            result = await this.search(args, httpReq)
                            break
                        case 'get_note':
                            result = await this.getNote(args, httpReq)
                            break
                        case 'update_note':
                            result = await this.updateNote(args, httpReq)
                            break
                        case 'get_tasks':
                            result = await this.getTasks(args, httpReq)
                            break
                        case 'get_user_projects':
                            result = await this.getUserProjects(args, httpReq)
                            break
                        case 'get_focus_task':
                            result = await this.getFocusTask(args, httpReq)
                            break
                        case 'delete_authentication_data':
                            result = await this.deleteAuthenticationData(args, httpReq)
                            break
                        case 'get_current_user_info':
                            result = await this.getCurrentUserInfo(args, httpReq)
                            break
                        default:
                            throw new Error(`Unknown tool: ${name}`)
                    }

                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                        },
                    }
                } catch (error) {
                    console.error(`Tool error for ${name}:`, error)
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({ error: error.message }, null, 2),
                                },
                            ],
                            isError: true,
                        },
                    }
                }
            }

            // Handle resources/list
            if (request.method === 'resources/list') {
                const resources = {
                    resources: [
                        {
                            uri: 'alldone://projects/',
                            name: 'Projects',
                            description: 'List of accessible projects',
                            mimeType: 'application/json',
                        },
                        {
                            uri: 'alldone://user/profile',
                            name: 'User Profile',
                            description: 'Current user profile information',
                            mimeType: 'application/json',
                        },
                        {
                            uri: 'alldone://user/projects',
                            name: 'User Projects',
                            description: 'Projects accessible to the current user',
                            mimeType: 'application/json',
                        },
                    ],
                }
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: resources,
                }
            }

            // Handle logging/setLevel
            if (request.method === 'logging/setLevel') {
                const { level } = request.params
                // For now, we'll accept any level but not actually change logging behavior
                // In a production server, you would configure your logger here
                console.log(`Logging level set to: ${level}`)
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {},
                }
            }

            // Handle resources/read
            if (request.method === 'resources/read') {
                const { uri } = request.params
                console.log('Resource read request:', JSON.stringify(request.params, null, 2))

                try {
                    let content
                    if (uri === 'alldone://user/projects') {
                        const userId = await this.getAuthenticatedUserForClient({ headers: httpReq.headers })
                        const projects = await this.getUserProjects({}, { headers: httpReq.headers })
                        content = JSON.stringify(projects, null, 2)
                    } else if (uri === 'alldone://user/profile') {
                        const userId = await this.getAuthenticatedUserForClient({ headers: httpReq.headers })
                        content = JSON.stringify({ userId, message: 'User profile resource' }, null, 2)
                    } else {
                        return {
                            jsonrpc: '2.0',
                            id: request.id,
                            error: { code: -32602, message: 'Invalid resource URI', data: uri },
                        }
                    }

                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            contents: [
                                {
                                    uri: uri,
                                    mimeType: 'application/json',
                                    text: content,
                                },
                            ],
                        },
                    }
                } catch (error) {
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: { code: -32603, message: 'Resource access failed', data: error.message },
                    }
                }
            }

            // Method not found
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32601, message: 'Method not found', data: request.method },
            }
        } catch (error) {
            // Check if this is an authentication error that should return HTTP 401
            if (error.statusCode === 401) {
                // Re-throw to be handled by the HTTP transport layer
                throw error
            }
            console.error('Single JSON-RPC error:', error)
            return {
                jsonrpc: '2.0',
                id: request.id || null,
                error: { code: -32603, message: 'Internal error', data: error.message },
            }
        }
    }

    async handleRequest(req, res) {
        try {
            // Log all requests to help debug Claude Code OAuth issues
            console.error('MCP Request:', {
                method: req.method,
                path: req.path || req.url,
                userAgent: req.headers['user-agent'],
                accept: req.headers['accept'],
                referer: req.headers['referer'],
                authorization: req.headers['authorization'] ? 'present' : 'none',
                contentType: req.headers['content-type'],
                timestamp: new Date().toISOString(),
            })
            res.set({
                'Access-Control-Allow-Origin': '*', // Allow everything for debugging
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
                'Access-Control-Allow-Headers': '*', // Allow all headers
                'Access-Control-Allow-Credentials': 'false', // Must be false when origin is *
                'Access-Control-Max-Age': '86400',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
            })

            if (req.method === 'OPTIONS') {
                res.status(200).end()
                return
            }

            // === OAUTH DCR ENDPOINTS (HTTP) ===
            // IMPORTANT: These must be handled BEFORE MCP endpoints since /register, /auth/* are not MCP endpoints

            // Handle OAuth 2.0 Authorization Server Metadata discovery
            if (
                req.path === '/.well-known/oauth-authorization-server' ||
                req.url === '/.well-known/oauth-authorization-server' ||
                req.path === '/mcpServer/.well-known/oauth-authorization-server' ||
                req.url === '/mcpServer/.well-known/oauth-authorization-server' ||
                req.path === '/.well-known/oauth-authorization-server/mcpServer' ||
                req.url === '/.well-known/oauth-authorization-server/mcpServer'
            ) {
                const baseUrl = `${getBaseUrl()}/mcpServer`
                console.log('🔎 OAuth AS metadata baseUrl:', baseUrl)

                res.set('Content-Type', 'application/json; charset=utf-8')
                    .set('Cache-Control', 'no-store')
                    .json({
                        issuer: baseUrl,
                        authorization_endpoint: `${baseUrl}/authorize`,
                        token_endpoint: `${baseUrl}/token`,
                        registration_endpoint: `${baseUrl}/register`,
                        token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
                        scopes_supported: ['read', 'write', 'mcp:tools'],
                        response_types_supported: ['code'],
                        grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
                        subject_types_supported: ['public'],
                        id_token_signing_alg_values_supported: ['RS256'],
                        code_challenge_methods_supported: ['S256'],
                        // MCP-specific extensions
                        'x-mcp-recommended-flows': {
                            user_interactions: 'authorization_code',
                            service_to_service: 'client_credentials',
                        },
                        'x-mcp-auth-instructions':
                            'For MCP clients: Use authorization_code for user interactions (with PKCE) or client_credentials for service-to-service (with API key).',
                    })
                return
            }

            // Handle OAuth 2.0 Protected Resource Metadata discovery (RFC 9728)
            if (
                req.path === '/.well-known/oauth-protected-resource' ||
                req.url === '/.well-known/oauth-protected-resource' ||
                req.path === '/mcpServer/.well-known/oauth-protected-resource' ||
                req.url === '/mcpServer/.well-known/oauth-protected-resource' ||
                req.path === '/.well-known/oauth-protected-resource/mcpServer' ||
                req.url === '/.well-known/oauth-protected-resource/mcpServer'
            ) {
                const baseUrl = `${getBaseUrl()}/mcpServer`
                console.log('🔎 OAuth PR metadata baseUrl:', baseUrl)

                res.set('Content-Type', 'application/json; charset=utf-8')
                    .set('Cache-Control', 'no-store')
                    .json({
                        resource: baseUrl,
                        authorization_servers: [baseUrl],
                        scopes_supported: ['read', 'write', 'mcp:tools'],
                        bearer_methods_supported: ['header'],
                        resource_documentation: 'https://modelcontextprotocol.io',
                    })
                return
            }

            // Handle OAuth Dynamic Client Registration
            if (
                (req.path === '/register' ||
                    req.url === '/register' ||
                    req.path === '/mcpServer/register' ||
                    req.url === '/mcpServer/register') &&
                req.method === 'POST'
            ) {
                // Check rate limits for client registration
                const rateLimitCheck = await this.checkRateLimits(req, 'CLIENT_REGISTER')
                if (!rateLimitCheck.allowed) {
                    res.status(429).json({
                        error: 'too_many_requests',
                        error_description: 'Rate limit exceeded for client registration',
                        retry_after: Math.ceil((rateLimitCheck.errorResponse.error.data.resetTime - new Date()) / 1000),
                    })
                    return
                }

                try {
                    // Generate unique client credentials and store them
                    const clientId = `alldone-mcp-${uuidv4()}`
                    const clientSecret = `secret-${uuidv4()}`

                    const clientData = {
                        clientId,
                        clientSecret,
                        createdAt: admin.firestore.Timestamp.now(),
                        redirectUris: req.body.redirect_uris || ['https://claude.ai/api/mcp/auth_callback'],
                        grantTypes: ['authorization_code', 'refresh_token'],
                        scopes: ['read', 'write', 'mcp:tools'],
                        tokenEndpointAuthMethod: 'none',
                    }

                    // Store client registration in Firestore for later validation
                    const db = admin.firestore()
                    await db.collection('oauthClients').doc(clientId).set(clientData)

                    res.set('Content-Type', 'application/json; charset=utf-8').json({
                        client_id: clientId,
                        client_secret: clientSecret,
                        client_id_issued_at: Math.floor(Date.now() / 1000),
                        client_secret_expires_at: 0, // Never expires
                        redirect_uris: req.body.redirect_uris || ['https://claude.ai/api/mcp/auth_callback'],
                        token_endpoint_auth_method: 'none',
                        grant_types: ['authorization_code', 'refresh_token'],
                        response_types: ['code'],
                        scope: 'read write mcp:tools',
                    })
                    return
                } catch (error) {
                    console.error('❌ Client registration error:', error)
                    console.error('Error details:', {
                        message: error.message,
                        stack: error.stack,
                    })
                    res.status(500).set('Content-Type', 'application/json; charset=utf-8').json({
                        error: 'Client registration failed',
                        message: error.message,
                    })
                    return
                }
            }

            // Handle OAuth login
            if (
                req.path === '/auth/login' ||
                req.url?.includes('/auth/login') ||
                req.path === '/mcpServer/auth/login' ||
                req.url?.includes('/mcpServer/auth/login')
            ) {
                const { session_id, auth_code, redirect_uri, state } = req.query
                if (!session_id) {
                    res.status(400).json({ error: 'Missing session_id parameter' })
                    return
                }

                const authPage = this.oauthHandler.generateAuthPage(session_id, auth_code, redirect_uri, state)
                res.set('Content-Type', 'text/html')
                res.send(authPage)
                return
            }

            // Handle direct token generation endpoint - simple browser-based login
            if (
                req.path === '/get-token' ||
                req.url?.includes('/get-token') ||
                req.path === '/mcpServer/get-token' ||
                req.url?.includes('/mcpServer/get-token')
            ) {
                console.log('🎟️ === DIRECT TOKEN REQUEST ===')
                console.log('📋 Request method:', req.method)

                if (req.method === 'GET') {
                    // Serve the login page
                    const loginPage = this.generateDirectLoginPage()
                    res.set('Content-Type', 'text/html')
                    res.send(loginPage)
                    return
                } else if (req.method === 'POST') {
                    // Handle token creation after Firebase auth
                    return await this.handleDirectTokenCreation(req, res)
                }
            }

            // Handle OAuth authorization endpoint - integrates with Firebase Auth
            if (
                req.path === '/authorize' ||
                req.url?.includes('/authorize') ||
                req.path === '/mcpServer/authorize' ||
                req.url?.includes('/mcpServer/authorize')
            ) {
                const requestTimestamp = new Date().toISOString()

                const {
                    client_id,
                    redirect_uri,
                    state,
                    scope = 'read write mcp:tools',
                    code_challenge,
                    code_challenge_method,
                } = req.query

                // Detect if this is a programmatic client (like Claude Code) vs browser
                const userAgent = req.headers['user-agent'] || ''
                const acceptHeader = req.headers['accept'] || ''
                const referer = req.headers['referer'] || ''

                // Very broad detection - assume programmatic unless clearly a browser
                const isBrowser =
                    acceptHeader.includes('text/html') &&
                    userAgent.includes('Mozilla') &&
                    (referer.includes('http') ||
                        userAgent.includes('Chrome') ||
                        userAgent.includes('Firefox') ||
                        userAgent.includes('Safari'))

                const isProgrammaticClient = !isBrowser

                if (isProgrammaticClient) {
                    // Direct programmatic clients to appropriate grant type per MCP specification
                    res.status(400)
                        .set('Content-Type', 'application/json; charset=utf-8')
                        .json({
                            error: 'unsupported_response_type',
                            error_description:
                                'Interactive authorization endpoint not supported for programmatic clients. Use appropriate grant type.',
                            recommended_flows: {
                                client_credentials: {
                                    description: 'For application-to-application access (no user interaction)',
                                    endpoint: `${getBaseUrl()}/mcpServer/token`,
                                    parameters: ['grant_type=client_credentials', 'client_id', 'api_key'],
                                    note: 'Requires pre-configured API key (MCP_API_KEY)',
                                },
                                authorization_code: {
                                    description: 'For user-based access (requires browser interaction)',
                                    instructions: [
                                        'Launch browser to complete OAuth flow',
                                        'Use PKCE (code_challenge and code_challenge_method=S256)',
                                        'Handle redirect URI callback',
                                    ],
                                },
                            },
                            supported_grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
                        })
                    return
                }

                console.log('📋 OAuth authorize parameters:', {
                    client_id: client_id,
                    redirect_uri: redirect_uri,
                    state: state,
                    scope: scope,
                    has_code_challenge: !!code_challenge,
                    code_challenge_method: code_challenge_method,
                })

                // Initialize Firestore database instance for authorization endpoint
                const db = admin.firestore()

                // Check for recent authorization requests from the same client (only if client_id is provided)
                console.log('🔍 Checking for recent authorization requests...')
                if (!client_id) {
                    console.log('⚠️ Skipping recent authorization lookup because client_id is missing')
                } else {
                    const fiveMinutesAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000))
                    const recentAuthSessions = await db
                        .collection('oauthAuthSessions')
                        .where('clientId', '==', client_id)
                        .where('createdAt', '>', fiveMinutesAgo)
                        .orderBy('createdAt', 'desc')
                        .get()

                    if (!recentAuthSessions.empty) {
                        console.log('⚠️ Recent authorization sessions found for this client:')
                        recentAuthSessions.docs.forEach((doc, index) => {
                            const data = doc.data()
                            console.log(
                                `   ${index + 1}. Auth Code: ${data.authCode}, Status: ${
                                    data.status
                                }, Created: ${data.createdAt?.toDate()?.toISOString()}, State: ${data.state}`
                            )
                        })
                        console.log(`📊 Total recent sessions for client ${client_id}: ${recentAuthSessions.size}`)

                        // Check for duplicate pending sessions (same state parameter)
                        if (state) {
                            const duplicateStateCheck = recentAuthSessions.docs.filter(
                                doc => doc.data().state === state && doc.data().status === 'pending'
                            )
                            if (duplicateStateCheck.length > 0) {
                                console.log(
                                    '🚨 DUPLICATE REQUEST DETECTED: Same client_id and state parameter in recent pending sessions!'
                                )
                                console.log(
                                    '🔍 Duplicate sessions details:',
                                    duplicateStateCheck.map(doc => ({
                                        authCode: doc.data().authCode,
                                        createdAt: doc.data().createdAt?.toDate()?.toISOString(),
                                        redirectUri: doc.data().redirectUri,
                                    }))
                                )

                                // Optional: Prevent very recent duplicates (within 30 seconds)
                                const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)
                                const veryRecentDuplicates = duplicateStateCheck.filter(
                                    doc => doc.data().createdAt?.toDate() > thirtySecondsAgo
                                )

                                if (veryRecentDuplicates.length > 0) {
                                    console.log(
                                        '⚠️ VERY RECENT DUPLICATE detected - considering redirect to existing session'
                                    )
                                    const existingSession = veryRecentDuplicates[0].data()
                                    console.log('🔄 Using existing session instead of creating new one:', {
                                        existingAuthCode: existingSession.authCode,
                                        existingSessionId: existingSession.sessionId,
                                        createdAt: existingSession.createdAt?.toDate()?.toISOString(),
                                    })

                                    // Redirect to existing session
                                    const baseUrl = getBaseUrl()
                                    const loginUrl = `${baseUrl}/mcpServer/auth/login?session_id=${
                                        existingSession.sessionId
                                    }&auth_code=${existingSession.authCode}&redirect_uri=${encodeURIComponent(
                                        redirect_uri || ''
                                    )}&state=${state || ''}`

                                    console.log('🔄 Redirecting to existing session instead of creating duplicate')
                                    res.redirect(loginUrl)
                                    return
                                }
                            }
                        }
                    } else {
                        console.log('✅ No recent authorization sessions found for this client')
                    }
                }

                // Check rate limits for authorization requests
                const rateLimitCheck = await this.checkRateLimits(req, 'CLIENT_AUTHORIZE')
                if (!rateLimitCheck.allowed) {
                    console.log('🚫 Authorization request blocked by rate limit')
                    res.status(429).json({
                        error: 'too_many_requests',
                        error_description: 'Rate limit exceeded for authorization requests',
                        retry_after: Math.ceil((rateLimitCheck.errorResponse.error.data.resetTime - new Date()) / 1000),
                    })
                    return
                }

                if (!client_id) {
                    console.log('❌ Missing client_id parameter')
                    res.status(400).set('Content-Type', 'application/json; charset=utf-8').json({
                        error: 'client_id is required',
                    })
                    return
                }

                // PKCE validation - required for MCP compliance
                if (!code_challenge || !code_challenge_method) {
                    res.status(400).set('Content-Type', 'application/json; charset=utf-8').json({
                        error: 'invalid_request',
                        error_description: 'PKCE parameters code_challenge and code_challenge_method are required',
                    })
                    return
                }

                if (code_challenge_method !== 'S256') {
                    res.status(400).set('Content-Type', 'application/json; charset=utf-8').json({
                        error: 'invalid_request',
                        error_description: 'Only S256 code_challenge_method is supported',
                    })
                    return
                }

                console.log('🔍 Verifying client exists in oauthClients collection...')
                // Verify client exists (reusing db instance from authorization endpoint)
                console.log('📋 Looking up client_id:', client_id)
                const clientDoc = await db.collection('oauthClients').doc(client_id).get()
                let clientData

                if (!clientDoc.exists) {
                    console.log('❌ CLIENT NOT FOUND in oauthClients collection')

                    // Check if auto-registration is enabled (default: true for backward compatibility)
                    const autoRegEnabled = process.env.OAUTH_AUTO_REGISTRATION !== 'false'
                    console.log('🔧 Auto-registration enabled:', autoRegEnabled)

                    if (!autoRegEnabled) {
                        console.log('❌ Auto-registration disabled - client must be pre-registered')
                        res.status(400).set('Content-Type', 'application/json; charset=utf-8').json({
                            error: 'Invalid client_id',
                            error_description: 'Client must be registered via /register endpoint',
                        })
                        return
                    }

                    console.log('🔍 Attempting auto-registration for client:', client_id)

                    // Auto-register client with safety checks
                    try {
                        // Validate client_id format for security
                        if (
                            !client_id ||
                            typeof client_id !== 'string' ||
                            client_id.length < 5 ||
                            client_id.length > 100
                        ) {
                            console.log('❌ Invalid client_id format for auto-registration')
                            res.status(400).json({
                                error: 'Invalid client_id',
                                error_description: 'Client ID must be between 5-100 characters',
                            })
                            return
                        }

                        // Validate redirect_uri for security
                        if (!redirect_uri || !redirect_uri.startsWith('https://')) {
                            console.log('❌ Invalid redirect_uri for auto-registration:', redirect_uri)
                            res.status(400).json({
                                error: 'invalid_request',
                                error_description: 'HTTPS redirect_uri required for auto-registration',
                            })
                            return
                        }

                        // Create auto-registered client
                        const autoClientData = {
                            clientId: client_id,
                            clientSecret: `auto-secret-${uuidv4()}`, // Generate secret
                            createdAt: admin.firestore.Timestamp.now(),
                            redirectUris: [redirect_uri], // Only allow the requested URI
                            grantTypes: ['authorization_code', 'refresh_token'],
                            scopes: ['read', 'write', 'mcp:tools'],
                            tokenEndpointAuthMethod: 'none',
                            autoRegistered: true, // Mark as auto-registered
                            autoRegisteredAt: admin.firestore.Timestamp.now(),
                        }

                        console.log('🆔 Auto-registering client:', {
                            clientId: client_id,
                            redirectUri: redirect_uri,
                            isAutoRegistered: true,
                        })

                        await db.collection('oauthClients').doc(client_id).set(autoClientData)

                        // Update clientData for the rest of the flow
                        clientData = autoClientData
                        console.log('✅ Auto-registration successful')
                    } catch (autoRegError) {
                        console.log('❌ Auto-registration failed:', autoRegError.message)
                        res.status(400).json({ error: 'Invalid client_id' })
                        return
                    }
                } else {
                    console.log('✅ Client found in oauthClients collection')
                    clientData = clientDoc.data()
                }

                console.log('📋 Final client data:', {
                    clientId: clientData.clientId,
                    hasSecret: !!clientData.clientSecret,
                    redirectUris: clientData.redirectUris,
                    scopes: clientData.scopes,
                    isAutoRegistered: !!clientData.autoRegistered,
                })

                // Validate redirect_uri against registered URIs (allow loopback any-port per RFC 8252)
                console.log('🔍 Validating redirect_uri against registered URIs...')
                const registeredRedirectUris = clientData.redirectUris || []
                console.log('📋 Registered redirect URIs:', registeredRedirectUris)
                console.log('📋 Requested redirect URI:', redirect_uri)
                const isLoopback = uri => {
                    try {
                        const u = new URL(uri)
                        return (
                            (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
                            (u.protocol === 'http:' || u.protocol === 'https:')
                        )
                    } catch (e) {
                        return false
                    }
                }
                const redirectAllowed = (() => {
                    if (!redirect_uri) return false
                    if (registeredRedirectUris.includes(redirect_uri)) return true
                    // Allow loopback with any port if base (host+path) matches any registered loopback
                    if (isLoopback(redirect_uri)) {
                        try {
                            const reqUrl = new URL(redirect_uri)
                            return registeredRedirectUris.some(reg => {
                                try {
                                    const regUrl = new URL(reg)
                                    const baseMatch =
                                        regUrl.hostname === reqUrl.hostname &&
                                        regUrl.protocol === reqUrl.protocol &&
                                        regUrl.pathname === reqUrl.pathname
                                    return baseMatch
                                } catch (_) {
                                    return false
                                }
                            })
                        } catch (_) {
                            // fall through
                        }
                    }
                    return false
                })()
                if (!redirectAllowed) {
                    res.status(400).set('Content-Type', 'application/json; charset=utf-8').json({
                        error: 'invalid_request',
                        error_description: 'Invalid redirect_uri',
                    })
                    return
                }

                // Create authorization session and redirect to Firebase Auth
                console.log('🆔 === CREATING NEW AUTHORIZATION SESSION ===')
                const authCode = `auth_${uuidv4()}`
                const sessionId = uuidv4()

                console.log('🎫 Generated new authorization session:', {
                    authCode: authCode,
                    sessionId: sessionId,
                    clientId: client_id,
                    state: state,
                    timestamp: new Date().toISOString(),
                })

                // Store authorization request with PKCE data
                console.log('💾 Storing authorization session in Firestore...')
                await db
                    .collection('oauthAuthSessions')
                    .doc(authCode)
                    .set({
                        authCode,
                        clientId: client_id,
                        redirectUri: redirect_uri,
                        state,
                        scope,
                        sessionId,
                        // PKCE parameters
                        codeChallenge: code_challenge,
                        codeChallengeMethod: code_challenge_method,
                        createdAt: admin.firestore.Timestamp.now(),
                        expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)), // 30 min
                        status: 'pending',
                    })

                console.log('✅ Authorization session stored successfully in Firestore')
                console.log('📊 Session details:', {
                    authCode: authCode,
                    clientId: client_id,
                    status: 'pending',
                    expiresInMinutes: 30,
                    hasPKCE: !!(code_challenge && code_challenge_method),
                })

                // Redirect to Firebase Auth login with state - always use hosting domain
                console.log('🔀 === REDIRECTING TO FIREBASE AUTH ===')
                const baseUrl = getBaseUrl()
                const loginUrl = `${baseUrl}/mcpServer/auth/login?session_id=${sessionId}&auth_code=${authCode}&redirect_uri=${encodeURIComponent(
                    redirect_uri || ''
                )}&state=${state || ''}`

                console.log('🌐 Login URL generated:', loginUrl)
                console.log('🎯 Redirecting client to Firebase Auth...')
                res.redirect(loginUrl)
                return
            }

            // Handle OAuth token endpoint - exchanges auth code for access token
            if (
                req.path === '/token' ||
                req.url === '/token' ||
                req.path === '/mcpServer/token' ||
                req.url === '/mcpServer/token'
            ) {
                if (req.method === 'POST') {
                    // Check rate limits for token requests
                    const rateLimitCheck = await this.checkRateLimits(req, 'CLIENT_TOKEN')
                    if (!rateLimitCheck.allowed) {
                        console.log('🚫 Token request blocked by rate limit')
                        res.status(429).json({
                            error: 'too_many_requests',
                            error_description: 'Rate limit exceeded for token requests',
                            retry_after: Math.ceil(
                                (rateLimitCheck.errorResponse.error.data.resetTime - new Date()) / 1000
                            ),
                        })
                        return
                    }

                    // Support client_secret_basic in Authorization header
                    try {
                        const authHeader = req.headers['authorization'] || req.headers['Authorization']
                        if (authHeader && authHeader.startsWith('Basic ')) {
                            const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8')
                            const sepIndex = decoded.indexOf(':')
                            if (sepIndex > -1) {
                                const headerClientId = decoded.substring(0, sepIndex)
                                const headerClientSecret = decoded.substring(sepIndex + 1)
                                if (!req.body.client_id) req.body.client_id = headerClientId
                                if (!req.body.client_secret && headerClientSecret)
                                    req.body.client_secret = headerClientSecret
                            } else if (decoded.length > 0) {
                                // Some clients may send only client_id with no ':'
                                if (!req.body.client_id) req.body.client_id = decoded
                            }
                        }
                    } catch (e) {
                        console.log('⚠️ Failed to parse Basic auth header:', e.message)
                    }

                    const {
                        code,
                        client_id,
                        client_secret,
                        redirect_uri,
                        grant_type,
                        code_verifier,
                        refresh_token,
                    } = req.body

                    if (
                        grant_type !== 'authorization_code' &&
                        grant_type !== 'refresh_token' &&
                        grant_type !== 'client_credentials'
                    ) {
                        res.status(400)
                            .set('Content-Type', 'application/json; charset=utf-8')
                            .json({
                                error: 'unsupported_grant_type',
                                error_description:
                                    'Supported grant types are authorization_code, refresh_token, and client_credentials.',
                                supported_grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
                            })
                        return
                    }

                    if (!client_id) {
                        res.status(400)
                            .set('Content-Type', 'application/json; charset=utf-8')
                            .json({ error: 'invalid_request' })
                        return
                    }

                    try {
                        console.log('🔍 Verifying client credentials in token endpoint...')
                        console.log('📋 Client ID for token request:', client_id)

                        // Initialize Firestore database instance for token endpoint
                        const db = admin.firestore()

                        // Verify client credentials
                        const clientDoc = await db.collection('oauthClients').doc(client_id).get()
                        if (!clientDoc.exists) {
                            console.log('❌ CLIENT NOT FOUND in token endpoint')
                            console.log('🔍 Debugging - listing existing clients...')

                            try {
                                const allClients = await db.collection('oauthClients').limit(5).get()
                                console.log('📋 Available clients for token endpoint:')
                                allClients.forEach(doc => {
                                    console.log('  - Token endpoint client:', doc.id)
                                })
                            } catch (err) {
                                console.log('❌ Error listing clients:', err.message)
                            }

                            res.status(401).json({ error: 'invalid_client' })
                            return
                        }

                        console.log('✅ Client found for token request')
                        const clientData = clientDoc.data()
                        console.log('🔍 Token request client details:', {
                            clientId: clientData.clientId,
                            grantTypes: clientData.grantTypes,
                            scopes: clientData.scopes,
                            isAutoRegistered: !!clientData.autoRegistered,
                        })

                        // Only verify client_secret if it's provided (optional for some flows)
                        console.log('🔐 Validating client credentials...')
                        console.log('📋 Client secret provided:', !!client_secret)
                        console.log('📋 Client has secret:', !!clientData.clientSecret)

                        if (client_secret && clientData.clientSecret !== client_secret) {
                            // If this client is configured for 'none', ignore secret mismatch
                            if (clientData.tokenEndpointAuthMethod && clientData.tokenEndpointAuthMethod !== 'none') {
                                console.log('❌ Client secret mismatch and auth method is not none')
                                res.status(401).json({ error: 'invalid_client' })
                                return
                            } else {
                                console.log(
                                    '⚠️ Client secret provided but client uses auth_method=none; ignoring mismatch'
                                )
                            }
                        }
                        console.log('✅ Client credentials validated')

                        console.log('🔄 Processing grant type:', grant_type)

                        if (grant_type === 'authorization_code') {
                            // Authorization Code Flow
                            console.log('🎫 === AUTHORIZATION CODE FLOW ===')
                            console.log('📋 Authorization code provided:', !!code)
                            console.log('📋 Code verifier provided:', !!code_verifier)
                            console.log('📋 Redirect URI provided:', !!redirect_uri)

                            if (!code) {
                                console.log('❌ Missing authorization code')
                                res.status(400).json({ error: 'invalid_request' })
                                return
                            }

                            // PKCE validation - code_verifier is required
                            if (!code_verifier) {
                                // Relax: some SDKs send code_verifier as 'codeVerifier'
                                const altVerifier = req.body.codeVerifier || req.body.code_verifier
                                if (!altVerifier) {
                                    console.log('❌ Missing PKCE code_verifier')
                                    res.status(400).json({
                                        error: 'invalid_request',
                                        error_description: 'code_verifier is required for PKCE',
                                    })
                                    return
                                }
                            }
                            console.log('✅ Required parameters present')

                            // Get and validate auth session
                            console.log('🔍 Looking up authorization session...')
                            console.log('📋 Authorization code:', code)
                            const authDoc = await db.collection('oauthAuthSessions').doc(code).get()
                            if (!authDoc.exists) {
                                console.log('❌ Authorization session not found')
                                res.status(400).json({ error: 'invalid_grant' })
                                return
                            }
                            console.log('✅ Authorization session found')

                            const authData = authDoc.data()
                            console.log('📊 Authorization session details:', {
                                status: authData.status,
                                clientId: authData.clientId,
                                requestedClientId: client_id,
                                userId: authData.userId,
                                mcpSessionId: authData.mcpSessionId,
                                scope: authData.scope,
                                hasCodeChallenge: !!authData.codeChallenge,
                                codeChallengeMethod: authData.codeChallengeMethod,
                                expiresAt: authData.expiresAt?.toDate(),
                                createdAt: authData.createdAt?.toDate(),
                            })

                            console.log('🔍 Validating authorization session...')
                            if (authData.status !== 'completed') {
                                console.log('❌ Authorization session not completed, status:', authData.status)
                                res.status(400).json({ error: 'invalid_grant' })
                                return
                            }

                            if (authData.clientId !== client_id) {
                                console.log('❌ Client ID mismatch:', {
                                    expected: authData.clientId,
                                    provided: client_id,
                                })
                                res.status(400).json({ error: 'invalid_grant' })
                                return
                            }
                            console.log('✅ Authorization session status and client validated')

                            // Check expiration
                            console.log('⏰ Checking authorization session expiration...')
                            const now = new Date()
                            const expiresAt = authData.expiresAt.toDate()
                            console.log('📅 Current time:', now.toISOString())
                            console.log('📅 Session expires at:', expiresAt.toISOString())

                            if (expiresAt < now) {
                                console.log('❌ Authorization session expired')
                                res.status(400).json({ error: 'expired_grant' })
                                return
                            }
                            console.log('✅ Authorization session not expired')

                            // If redirect_uri is provided on token request, validate against authorization request
                            console.log('🔗 Validating redirect URI...')
                            console.log('📋 Token request redirect_uri:', redirect_uri)
                            console.log('📋 Auth session redirect_uri:', authData.redirectUri)
                            const loopbackAnyPortMatch = (a, b) => {
                                try {
                                    const ua = new URL(a)
                                    const ub = new URL(b)
                                    const isLoop =
                                        (ua.hostname === 'localhost' || ua.hostname === '127.0.0.1') &&
                                        (ub.hostname === 'localhost' || ub.hostname === '127.0.0.1')
                                    if (!isLoop) return false
                                    return ua.protocol === ub.protocol && ua.pathname === ub.pathname
                                } catch (e) {
                                    return false
                                }
                            }
                            if (
                                redirect_uri &&
                                authData.redirectUri &&
                                redirect_uri !== authData.redirectUri &&
                                !loopbackAnyPortMatch(redirect_uri, authData.redirectUri)
                            ) {
                                console.log('❌ Redirect URI mismatch (after loopback any-port check)')
                                res.status(400).json({
                                    error: 'invalid_grant',
                                    error_description: 'redirect_uri mismatch',
                                })
                                return
                            }
                            console.log('✅ Redirect URI validated')

                            // PKCE verification - validate code_verifier against stored code_challenge
                            console.log('🔐 === PKCE VERIFICATION ===')
                            console.log('📋 Code challenge present:', !!authData.codeChallenge)
                            console.log('📋 Code challenge method:', authData.codeChallengeMethod)
                            console.log('📋 Code verifier length:', code_verifier?.length)

                            if (authData.codeChallenge && authData.codeChallengeMethod) {
                                console.log('🔍 Computing challenge from verifier...')
                                const verifier = code_verifier || req.body.codeVerifier
                                const challengeFromVerifier = crypto
                                    .createHash('sha256')
                                    .update(verifier)
                                    .digest()
                                    .toString('base64url')

                                console.log('📋 Expected challenge:', authData.codeChallenge.substring(0, 20) + '...')
                                console.log('📋 Computed challenge:', challengeFromVerifier.substring(0, 20) + '...')
                                console.log('🔍 Challenges match:', challengeFromVerifier === authData.codeChallenge)

                                if (challengeFromVerifier !== authData.codeChallenge) {
                                    console.log('❌ PKCE verification failed')
                                    res.status(400).json({
                                        error: 'invalid_grant',
                                        error_description: 'PKCE verification failed',
                                    })
                                    return
                                }
                                console.log('✅ PKCE verification successful')
                            } else {
                                console.log('⚠️ No PKCE challenge to verify')
                            }

                            // Generate access and refresh tokens
                            console.log('🎟️ === TOKEN GENERATION ===')
                            const accessToken = `mcp_access_${uuidv4()}`
                            const refreshToken = `mcp_refresh_${uuidv4()}`
                            console.log('🆔 Generated access token:', accessToken.substring(0, 20) + '...')
                            console.log('🆔 Generated refresh token:', refreshToken.substring(0, 20) + '...')

                            // Store token mapping to Firebase session
                            console.log('💾 === STORING TOKENS IN FIRESTORE ===')
                            const accessTokenData = {
                                accessToken,
                                refreshToken,
                                clientId: client_id,
                                userId: authData.userId,
                                mcpSessionId: authData.mcpSessionId,
                                scope: authData.scope || 'read write mcp:tools',
                                createdAt: admin.firestore.Timestamp.now(),
                                expiresAt: admin.firestore.Timestamp.fromDate(
                                    new Date(Date.now() + 30 * 24 * 3600 * 1000)
                                ), // 30 days
                            }

                            console.log('📝 Storing access token data:', {
                                collection: 'oauthTokens',
                                docId: accessToken.substring(0, 20) + '...',
                                userId: accessTokenData.userId,
                                clientId: accessTokenData.clientId,
                                scope: accessTokenData.scope,
                                expiresAt: accessTokenData.expiresAt.toDate(),
                            })

                            await db.collection('oauthTokens').doc(accessToken).set(accessTokenData)
                            console.log('✅ Access token stored successfully')

                            // Store refresh token (longer expiry)
                            const refreshTokenData = {
                                refreshToken,
                                clientId: client_id,
                                userId: authData.userId,
                                mcpSessionId: authData.mcpSessionId,
                                scope: authData.scope || 'read write mcp:tools',
                                createdAt: admin.firestore.Timestamp.now(),
                                expiresAt: admin.firestore.Timestamp.fromDate(
                                    new Date(Date.now() + 30 * 24 * 3600 * 1000)
                                ), // 30 days
                            }

                            console.log('📝 Storing refresh token data:', {
                                collection: 'oauthRefreshTokens',
                                docId: refreshToken.substring(0, 20) + '...',
                                userId: refreshTokenData.userId,
                                clientId: refreshTokenData.clientId,
                                expiresAt: refreshTokenData.expiresAt.toDate(),
                            })

                            await db.collection('oauthRefreshTokens').doc(refreshToken).set(refreshTokenData)
                            console.log('✅ Refresh token stored successfully')

                            // Update user session with MCP access token (not Firebase token)
                            console.log('🔄 Updating user session with MCP access token...')
                            const userSessionRef = db.collection('mcpUserSessions').doc(authData.userId)
                            await userSessionRef.set(
                                {
                                    userId: authData.userId,
                                    email: authData.userId, // Will be updated if we have email from auth data
                                    bearerToken: accessToken, // Store MCP access token, not Firebase token
                                    sessionId: authData.mcpSessionId,
                                    createdAt: admin.firestore.Timestamp.now(),
                                    expiresAt: admin.firestore.Timestamp.fromDate(
                                        new Date(Date.now() + 30 * 24 * 3600 * 1000)
                                    ), // 30 days
                                    lastUsed: admin.firestore.Timestamp.now(),
                                },
                                { merge: true }
                            )
                            console.log('✅ User session updated with MCP access token')

                            // Clean up auth session
                            console.log('🧹 Cleaning up authorization session...')
                            console.log('📋 Deleting auth session:', code)
                            await db.collection('oauthAuthSessions').doc(code).delete()
                            console.log('✅ Authorization session cleaned up')

                            // Prepare response
                            console.log('📤 === PREPARING TOKEN RESPONSE ===')
                            const tokenResponse = {
                                access_token: accessToken,
                                token_type: 'Bearer',
                                expires_in: 30 * 24 * 3600, // 30 days in seconds
                                scope: authData.scope || 'read write mcp:tools',
                                refresh_token: refreshToken,
                            }

                            console.log('🎉 Token exchange successful:', {
                                hasAccessToken: !!tokenResponse.access_token,
                                hasRefreshToken: !!tokenResponse.refresh_token,
                                tokenType: tokenResponse.token_type,
                                expiresIn: tokenResponse.expires_in,
                                scope: tokenResponse.scope,
                                userId: authData.userId,
                                clientId: client_id,
                            })

                            res.json(tokenResponse)
                            return
                        } else if (grant_type === 'refresh_token') {
                            // Refresh Token Flow
                            console.log('🔄 === REFRESH TOKEN FLOW ===')
                            console.log('📋 Refresh token provided:', !!refresh_token)

                            if (!refresh_token) {
                                console.log('❌ Missing refresh token')
                                res.status(400).json({
                                    error: 'invalid_request',
                                    error_description: 'Missing refresh_token parameter',
                                })
                                return
                            }

                            // Look up refresh token
                            console.log('🔍 Looking up refresh token...')
                            const refreshDoc = await db.collection('oauthRefreshTokens').doc(refresh_token).get()
                            if (!refreshDoc.exists) {
                                console.log('❌ Refresh token not found')
                                res.status(400).json({
                                    error: 'invalid_grant',
                                    error_description: 'Refresh token not found or has been revoked',
                                })
                                return
                            }

                            const refreshData = refreshDoc.data()
                            console.log('✅ Refresh token found:', {
                                clientId: refreshData.clientId,
                                userId: refreshData.userId,
                                expiresAt: refreshData.expiresAt?.toDate(),
                                scope: refreshData.scope,
                            })

                            // Validate client
                            if (refreshData.clientId !== client_id) {
                                console.log('❌ Client ID mismatch for refresh token')
                                res.status(401).json({
                                    error: 'invalid_client',
                                    error_description: 'Refresh token does not belong to this client',
                                })
                                return
                            }

                            // Check expiration
                            if (refreshData.expiresAt.toDate() < new Date()) {
                                console.log('❌ Refresh token expired')
                                // Clean up expired refresh token
                                await db.collection('oauthRefreshTokens').doc(refresh_token).delete()
                                res.status(400).json({
                                    error: 'invalid_grant',
                                    error_description: 'Refresh token has expired',
                                })
                                return
                            }

                            // Generate new tokens
                            const newAccessToken = `mcp_access_${uuidv4()}`
                            const newRefreshToken = `mcp_refresh_${uuidv4()}`

                            console.log('🔄 Generating new token pair...')

                            // Use batch operation for atomic token rotation
                            const batch = db.batch()

                            // Create new access token
                            const newAccessTokenData = {
                                accessToken: newAccessToken,
                                refreshToken: newRefreshToken,
                                clientId: refreshData.clientId,
                                userId: refreshData.userId,
                                mcpSessionId: refreshData.mcpSessionId,
                                scope: refreshData.scope,
                                grantType: 'refresh_token',
                                createdAt: admin.firestore.Timestamp.now(),
                                expiresAt: admin.firestore.Timestamp.fromDate(
                                    new Date(Date.now() + 30 * 24 * 3600 * 1000)
                                ), // 30 days
                            }
                            batch.set(db.collection('oauthTokens').doc(newAccessToken), newAccessTokenData)

                            // Create new refresh token with extended expiry
                            const newRefreshTokenData = {
                                refreshToken: newRefreshToken,
                                clientId: refreshData.clientId,
                                userId: refreshData.userId,
                                mcpSessionId: refreshData.mcpSessionId,
                                scope: refreshData.scope,
                                createdAt: admin.firestore.Timestamp.now(),
                                expiresAt: admin.firestore.Timestamp.fromDate(
                                    new Date(Date.now() + 30 * 24 * 3600 * 1000)
                                ), // 30 days
                                previousRefreshToken: refresh_token, // Audit trail
                            }
                            batch.set(db.collection('oauthRefreshTokens').doc(newRefreshToken), newRefreshTokenData)

                            // Revoke old refresh token (token rotation security)
                            batch.delete(db.collection('oauthRefreshTokens').doc(refresh_token))

                            // Find and revoke old access tokens that used this refresh token
                            const oldTokensQuery = await db
                                .collection('oauthTokens')
                                .where('refreshToken', '==', refresh_token)
                                .get()

                            console.log(`🧹 Revoking ${oldTokensQuery.size} old access tokens`)
                            oldTokensQuery.docs.forEach(doc => {
                                batch.delete(doc.ref)
                            })

                            // Commit all changes atomically
                            await batch.commit()
                            console.log('✅ Token rotation completed successfully')

                            // Update user session with new MCP access token
                            console.log('🔄 Updating user session with new MCP access token...')
                            const userSessionRef = db.collection('mcpUserSessions').doc(refreshData.userId)
                            await userSessionRef.set(
                                {
                                    userId: refreshData.userId,
                                    bearerToken: newAccessToken, // Store new MCP access token
                                    sessionId: refreshData.mcpSessionId,
                                    expiresAt: admin.firestore.Timestamp.fromDate(
                                        new Date(Date.now() + 30 * 24 * 3600 * 1000)
                                    ), // 30 days
                                    lastUsed: admin.firestore.Timestamp.now(),
                                },
                                { merge: true }
                            )
                            console.log('✅ User session updated with new MCP access token')

                            const tokenResponse = {
                                access_token: newAccessToken,
                                token_type: 'Bearer',
                                expires_in: 30 * 24 * 3600, // 30 days in seconds
                                scope: refreshData.scope,
                                refresh_token: newRefreshToken, // Include new refresh token
                            }

                            console.log('🎉 Refresh token flow successful:', {
                                hasAccessToken: !!tokenResponse.access_token,
                                hasRefreshToken: !!tokenResponse.refresh_token,
                                tokenType: tokenResponse.token_type,
                                expiresIn: tokenResponse.expires_in,
                                scope: tokenResponse.scope,
                                userId: refreshData.userId,
                                clientId: client_id,
                                oldTokensRevoked: oldTokensQuery.size,
                            })

                            res.json(tokenResponse)
                            return
                        } else if (grant_type === 'client_credentials') {
                            // Client Credentials Flow - for MCP compliance (application-to-application)
                            const scope = req.body.scope || 'read write mcp:tools'

                            // For MCP client credentials flow, require a pre-shared API key for security
                            const apiKey = req.body.api_key || req.headers['x-api-key']
                            if (!apiKey || apiKey !== process.env.MCP_API_KEY) {
                                res.status(401).set('Content-Type', 'application/json; charset=utf-8').json({
                                    error: 'invalid_client',
                                    error_description:
                                        'API key required for client credentials flow. Contact administrator for MCP_API_KEY.',
                                })
                                return
                            }

                            // Generate access token for client credentials flow
                            const accessToken = `mcp_cc_${uuidv4()}`

                            // Store token mapping for client credentials (no user interaction required)
                            await db
                                .collection('oauthTokens')
                                .doc(accessToken)
                                .set({
                                    accessToken,
                                    refreshToken: null, // No refresh token for client credentials
                                    clientId: client_id,
                                    userId: process.env.MCP_DEFAULT_USER_ID || null, // Use configured service user
                                    mcpSessionId: null,
                                    scope: scope,
                                    grantType: 'client_credentials',
                                    createdAt: admin.firestore.Timestamp.now(),
                                    expiresAt: admin.firestore.Timestamp.fromDate(
                                        new Date(Date.now() + 24 * 3600 * 1000)
                                    ), // 24 hours for service-to-service
                                })

                            res.json({
                                access_token: accessToken,
                                token_type: 'Bearer',
                                expires_in: 86400, // 24 hours
                                scope: scope,
                            })
                            return
                        }
                    } catch (error) {
                        console.error('Token exchange error:', error)
                        res.status(500).set('Content-Type', 'application/json; charset=utf-8').json({
                            error: 'server_error',
                            message: error.message,
                        })
                        return
                    }
                }
            }

            // OAuth callback handling is now handled by dedicated mcpOAuthCallback Cloud Function

            // Handle health check - handle both direct and prefixed paths
            if (
                req.path === '/health' ||
                req.url === '/health' ||
                req.path === '/mcpServer/health' ||
                req.url === '/mcpServer/health'
            ) {
                res.set('Content-Type', 'application/json; charset=utf-8').json({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    version: '1.0.0',
                    environment: process.env.FUNCTIONS_EMULATOR ? 'local' : 'cloud',
                })
                return
            }

            // Handle info endpoint - handle both direct and prefixed paths
            if (
                req.path === '/info' ||
                req.url === '/info' ||
                req.path === '/mcpServer/info' ||
                req.url === '/mcpServer/info'
            ) {
                res.set('Content-Type', 'application/json; charset=utf-8').json({
                    name: 'alldone-mcp-server',
                    version: '1.0.0',
                    description: 'MCP server for Alldone integration with Claude (Cloud Function)',
                    capabilities: {
                        resources: {},
                        tools: {},
                    },
                })
                return
            }

            // Handle MCP requests - HTTP Transport (2025-03-26)
            // Since this is the mcpServer Cloud Function, handle root path requests as MCP
            // unless they're specific OAuth/API endpoints
            if (
                !req.path?.startsWith('/auth') &&
                req.path !== '/authorize' &&
                req.path !== '/token' &&
                !req.path?.startsWith('/register') &&
                !req.path?.startsWith('/.well-known') &&
                req.path !== '/health' &&
                req.path !== '/info'
            ) {
                // Check if this is an authenticated request - if not, check if auth is required
                const authHeader = req.headers.authorization

                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    // Check if this is a tools/call request for an authenticated tool
                    if (req.method === 'POST' && req.body && req.body.method === 'tools/call') {
                        const toolName = req.body.params?.name
                        const authenticatedTools = [
                            'create_task',
                            'update_task',
                            'get_tasks',
                            'get_user_projects',
                            'get_focus_task',
                        ]

                        if (authenticatedTools.includes(toolName)) {
                            const baseUrl = `${getBaseUrl()}/mcpServer`

                            res.status(401)
                                .set({
                                    'WWW-Authenticate': `Bearer realm="mcp-server", error="invalid_token", error_description="Authentication required"`,
                                    Link: `<${baseUrl}/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"`,
                                })
                                .json({
                                    error: 'unauthorized',
                                    error_description: 'Authentication required. Please authenticate via OAuth.',
                                    oauth_metadata: `${baseUrl}/.well-known/oauth-protected-resource`,
                                })
                            return
                        }
                    }
                }

                // Handle MCP protocol using HTTP transport
                return await this.handleHTTP(req, res)
            }

            // If we get here, it's an unhandled endpoint
            // Force JSON response for OAuth-related requests to prevent HTML errors
            const isOAuthRelated =
                req.path?.includes('auth') ||
                req.path?.includes('oauth') ||
                req.headers['user-agent']?.toLowerCase().includes('oauth') ||
                req.query?.client_id ||
                req.query?.response_type ||
                req.query?.grant_type

            if (isOAuthRelated) {
                console.error('OAuth-related request to unhandled endpoint - forcing JSON response')
                res.status(404)
                    .set('Content-Type', 'application/json; charset=utf-8')
                    .json({
                        error: 'oauth_endpoint_not_found',
                        error_description: `OAuth endpoint ${req.path || req.url} not found`,
                        available_oauth_endpoints: [
                            '/.well-known/oauth-authorization-server',
                            '/register',
                            '/authorize (use client_credentials flow instead)',
                            '/token',
                        ],
                        recommended_flow: 'client_credentials',
                        token_endpoint: `${getBaseUrl()}/token`,
                    })
                return
            }

            // Return JSON error, not HTML
            res.status(404)
                .set('Content-Type', 'application/json; charset=utf-8')
                .json({
                    error: 'Endpoint not found',
                    path: req.path || req.url,
                    method: req.method,
                    timestamp: new Date().toISOString(),
                    available_endpoints: [
                        '/.well-known/oauth-authorization-server',
                        '/.well-known/oauth-protected-resource',
                        '/register',
                        '/authorize',
                        '/token',
                        '/health',
                        '/info',
                        '/ (MCP root)',
                    ],
                })
        } catch (error) {
            console.error('=== MCP SERVER ERROR ===')
            console.error('Error:', error)
            console.error('Stack:', error.stack)
            console.error('Request path:', req.path)
            console.error('Request method:', req.method)
            console.error('========================')

            // Ensure we return JSON, not HTML
            res.status(500).set('Content-Type', 'application/json').json({
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString(),
            })
        }
    }
}

// Export factory function for Cloud Functions
module.exports = { AlldoneSimpleMCPServer }
