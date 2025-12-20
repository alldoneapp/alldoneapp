/**
 * SearchService - Universal search service for Alldone
 *
 * This service provides unified search capabilities across all entity types:
 * - Tasks, Goals, Notes, Contacts, Chats, Assistants, Users
 * - Natural language query parsing
 * - Cross-platform compatibility (MCP Server, Cloud Functions, Assistant Tools, Frontend)
 * - Leverages existing Algolia infrastructure
 *
 * Follows the same architectural pattern as TaskService for consistency.
 */

// Import shared utilities (using dynamic imports for cross-platform compatibility)
let algoliasearch, moment, getAlgoliaClient, getNoteContent, parseTextForSearch

// Dynamic imports for cross-platform compatibility
async function loadDependencies() {
    if (!algoliasearch) {
        try {
            // Try CommonJS first (Node.js/Cloud Functions)
            if (typeof require !== 'undefined') {
                algoliasearch = require('algoliasearch')
                moment = require('moment')
                const searchHelper = require('../searchHelper')
                const parsingHelper = require('../ParsingTextHelper')
                getAlgoliaClient = searchHelper.getAlgoliaClient
                getNoteContent = searchHelper.getNoteContent
                parseTextForSearch = parsingHelper.parseTextForSearch
            } else {
                // Fall back to ES6 imports (React Native/Web)
                const [algolia, momentLib] = await Promise.all([import('algoliasearch'), import('moment')])
                algoliasearch = algolia.default || algolia
                moment = momentLib.default || momentLib
                // Note: For React Native/Web, search functionality would use different backends
            }
        } catch (error) {
            console.error('Failed to load SearchService dependencies:', error)
            throw new Error('SearchService initialization failed')
        }
    }
}

// Search constants (matching existing Algolia infrastructure)
const SEARCH_INDICES = {
    TASKS: 'dev_tasks',
    GOALS: 'dev_goals',
    NOTES: 'dev_notes',
    CONTACTS: 'dev_contacts',
    CHATS: 'dev_updates',
    ASSISTANTS: 'dev_contacts', // Assistants use same index as contacts
    USERS: 'dev_contacts', // Users use same index as contacts
}

const ENTITY_TYPES = {
    ALL: 'all',
    TASKS: 'tasks',
    GOALS: 'goals',
    NOTES: 'notes',
    CONTACTS: 'contacts',
    CHATS: 'chats',
    ASSISTANTS: 'assistants',
    USERS: 'users',
}

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 100

class SearchService {
    constructor(options = {}) {
        this.options = {
            // Database interface (Firestore admin, client, etc.)
            database: null,

            // Moment.js instance for date handling
            moment: null,

            // Environment-specific options
            isCloudFunction: typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR !== undefined,
            isReactNative: typeof navigator !== 'undefined' && navigator.product === 'ReactNative',
            isWeb: typeof window !== 'undefined',

            // Feature flags
            enableAlgolia: true,
            enableNoteContent: true,
            enableDateParsing: true,

            // Override any defaults
            ...options,
        }

        this.initialized = false
        this.algoliaClient = null
    }

    /**
     * Initialize the service (load dependencies)
     */
    async initialize() {
        if (this.initialized) return

        await loadDependencies()

        if (this.options.enableAlgolia && getAlgoliaClient) {
            this.algoliaClient = getAlgoliaClient()
        }

        this.initialized = true
    }

    /**
     * Ensure service is initialized
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize()
        }
    }

    /**
     * Enhanced search method with multi-pass optimization strategy
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchParams - Search parameters
     * @param {string} searchParams.query - Search query (required)
     * @param {string} [searchParams.type] - Entity type filter ('all', 'tasks', 'notes', etc.)
     * @param {string} [searchParams.projectId] - Limit search to specific project
     * @param {string} [searchParams.dateRange] - Time filter ('last week', 'yesterday', etc.)
     * @param {number} [searchParams.limit] - Maximum results to return
     * @returns {Object} Search results with matches from different entity types
     */
    async search(userId, searchParams) {
        await this.ensureInitialized()

        const { query, type = ENTITY_TYPES.ALL, projectId, dateRange, limit = DEFAULT_SEARCH_LIMIT } = searchParams

        // Validate input
        if (!query || typeof query !== 'string' || query.trim().length < 2) {
            throw new Error('Search query must be at least 2 characters long')
        }

        if (limit > MAX_SEARCH_LIMIT) {
            throw new Error(`Search limit cannot exceed ${MAX_SEARCH_LIMIT}`)
        }

        // Use enhanced search with result optimization
        return await this.searchWithOptimization(userId, searchParams)
    }

    /**
     * Enhanced search with multi-pass optimization based on result count
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchParams - Search parameters
     * @returns {Object} Optimized search results
     */
    async searchWithOptimization(userId, searchParams) {
        try {
            const { query, type = ENTITY_TYPES.ALL, projectId, dateRange, limit = DEFAULT_SEARCH_LIMIT } = searchParams
            const MAX_SEARCH_ATTEMPTS = 5
            let bestResults = null
            let searchAttempts = []

            // Try primary search first
            let results = await this.executeSearch(userId, searchParams)
            searchAttempts.push({ query, totalResults: results.totalResults, type: 'primary' })
            bestResults = results

            // Check if results are in optimal range (1-20)
            if (results.totalResults >= 1 && results.totalResults <= 20) {
                return {
                    ...results,
                    searchStrategy: {
                        finalQuery: query,
                        attempts: searchAttempts,
                        strategy: 'primary_success',
                    },
                }
            }

            // If >20 results, try more specific searches (with attempt limit)
            if (results.totalResults > 20) {
                let currentQuery = query
                let attemptCount = 1 // Already tried primary

                while (attemptCount < MAX_SEARCH_ATTEMPTS) {
                    const specificQuery = this.makeQueryMoreSpecific(currentQuery)

                    // If we can't make it more specific, break
                    if (specificQuery === currentQuery) {
                        break
                    }

                    const specificResults = await this.executeSearch(userId, { ...searchParams, query: specificQuery })
                    searchAttempts.push({
                        query: specificQuery,
                        totalResults: specificResults.totalResults,
                        type: 'specific',
                    })
                    attemptCount++

                    // Update best results if this is better
                    if (specificResults.totalResults <= 20) {
                        // Found optimal range!
                        return {
                            ...specificResults,
                            searchStrategy: {
                                finalQuery: specificQuery,
                                attempts: searchAttempts,
                                strategy: 'specificity_optimization_success',
                            },
                        }
                    } else if (specificResults.totalResults < bestResults.totalResults) {
                        // Better than what we had, but still too many
                        bestResults = specificResults
                        currentQuery = specificQuery
                    } else {
                        // Not improving, stop trying
                        break
                    }
                }

                // Return best results found (even if >20)
                return {
                    ...bestResults,
                    searchStrategy: {
                        finalQuery: bestResults === results ? query : currentQuery,
                        attempts: searchAttempts,
                        strategy: 'specificity_optimization_partial',
                        note: `Found ${bestResults.totalResults} results after ${attemptCount} attempts (max ${MAX_SEARCH_ATTEMPTS})`,
                    },
                }
            }

            // If 0 results, try fallback searches with more general terms (with attempt limit)
            if (results.totalResults === 0) {
                const fallbackQueries = this.generateFallbackQueries(query)
                let attemptCount = 1 // Already tried primary

                for (const fallbackQuery of fallbackQueries) {
                    if (attemptCount >= MAX_SEARCH_ATTEMPTS) {
                        break
                    }

                    const fallbackResults = await this.executeSearch(userId, { ...searchParams, query: fallbackQuery })
                    searchAttempts.push({
                        query: fallbackQuery,
                        totalResults: fallbackResults.totalResults,
                        type: 'fallback',
                    })
                    attemptCount++

                    if (fallbackResults.totalResults >= 1) {
                        // Check if we found optimal range
                        if (fallbackResults.totalResults <= 20) {
                            return {
                                ...fallbackResults,
                                searchStrategy: {
                                    finalQuery: fallbackQuery,
                                    attempts: searchAttempts,
                                    strategy: 'fallback_success',
                                    originalQuery: query,
                                },
                            }
                        } else {
                            // Found results but too many - keep as best option
                            bestResults = fallbackResults
                        }
                    }
                }

                // Return best results found (could be 0 or >20)
                return {
                    ...bestResults,
                    searchStrategy: {
                        finalQuery: bestResults === results ? query : searchAttempts[searchAttempts.length - 1].query,
                        attempts: searchAttempts,
                        strategy: bestResults.totalResults === 0 ? 'no_results_found' : 'fallback_partial',
                        originalQuery: query,
                        note:
                            bestResults.totalResults === 0
                                ? `No results found after ${attemptCount} attempts (max ${MAX_SEARCH_ATTEMPTS})`
                                : `Found ${bestResults.totalResults} results after fallback attempts`,
                    },
                }
            }

            // Return original results with strategy info (shouldn't reach here)
            return {
                ...results,
                searchStrategy: {
                    finalQuery: query,
                    attempts: searchAttempts,
                    strategy: 'no_optimization_applied',
                },
            }
        } catch (error) {
            console.error('Optimization search failed:', error)
            // Fallback to basic empty result if optimization crashes
            return {
                results: {},
                query: searchParams.query,
                totalResults: 0,
                message: `Search optimization failed: ${error.message}`,
                searchStrategy: {
                    strategy: 'optimization_failed',
                    error: error.message,
                },
            }
        }
    }

    /**
     * Core search execution method (original search logic)
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchParams - Search parameters
     * @returns {Object} Search results
     */
    async executeSearch(userId, searchParams) {
        const { query, type = ENTITY_TYPES.ALL, projectId, dateRange, limit = DEFAULT_SEARCH_LIMIT } = searchParams

        // Validate query
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return {
                results: {},
                query: query || '',
                totalResults: 0,
                message: 'Invalid or empty search query',
            }
        }

        try {
            await this.ensureInitialized()

            // Get user's accessible projects
            const userProjects = await this.getUserProjects(userId)
            if (userProjects.length === 0) {
                return {
                    results: {},
                    query,
                    totalResults: 0,
                    message: 'No accessible projects found for user',
                }
            }

            // Parse the search query for enhanced search capabilities
            let parsedQuery
            try {
                parsedQuery = await this.parseSearchQuery(query, dateRange)
            } catch (parseError) {
                console.error('Failed to parse search query:', parseError)
                // Return empty results instead of crashing
                return {
                    results: {},
                    query,
                    totalResults: 0,
                    message: `Query parsing failed: ${parseError.message}`,
                }
            }

            // Ensure we have keywords after parsing
            if (!parsedQuery.keywords || parsedQuery.keywords.length === 0) {
                return {
                    results: {},
                    query,
                    totalResults: 0,
                    message: 'No searchable keywords found in query',
                }
            }

            // Determine which entity types to search
            const entityTypes =
                type === ENTITY_TYPES.ALL
                    ? [
                          ENTITY_TYPES.TASKS,
                          ENTITY_TYPES.NOTES,
                          ENTITY_TYPES.GOALS,
                          ENTITY_TYPES.CONTACTS,
                          ENTITY_TYPES.CHATS,
                          ENTITY_TYPES.ASSISTANTS,
                      ]
                    : [type]

            // Execute searches across selected entity types
            const searchPromises = entityTypes.map(entityType =>
                this.searchEntityType(entityType, parsedQuery, userProjects, projectId, limit, userId)
            )

            const searchResults = await Promise.all(searchPromises)

            // Combine and structure results
            const results = {}
            let totalResults = 0

            searchResults.forEach((result, index) => {
                const entityType = entityTypes[index]
                results[entityType] = result
                totalResults += result.length
            })

            return {
                results,
                query: parsedQuery.originalQuery,
                parsedQuery: {
                    keywords: parsedQuery.keywords,
                    dateFilter: parsedQuery.dateFilter,
                    mentions: parsedQuery.mentions,
                    projects: parsedQuery.projects,
                },
                totalResults,
                searchedProjects: userProjects.map(p => ({ id: p.id, name: p.name })),
            }
        } catch (error) {
            console.error('Search execution failed:', {
                error: error.message,
                stack: error.stack,
                query,
                userId,
            })
            // Return empty results instead of throwing to prevent 502 errors
            return {
                results: {},
                query,
                totalResults: 0,
                message: `Search failed: ${error.message}`,
            }
        }
    }

    /**
     * Make query more specific for when there are too many results (>20)
     * @param {string} query - Original query
     * @returns {string} More specific query
     */
    makeQueryMoreSpecific(query) {
        // Remove common stop words that might make query too broad
        const stopWords = [
            'what',
            'where',
            'when',
            'how',
            'why',
            'who',
            'which',
            'are',
            'is',
            'was',
            'were',
            'be',
            'been',
            'being',
            'have',
            'has',
            'had',
            'do',
            'does',
            'did',
            'will',
            'would',
            'should',
            'could',
            'can',
            'may',
            'might',
            'must',
            'shall',
            'about',
            'for',
            'with',
            'by',
            'from',
            'at',
            'in',
            'on',
            'to',
            'of',
            'and',
            'or',
            'but',
            'if',
            'then',
            'than',
            'the',
            'a',
            'an',
        ]

        // Check if query is already quoted (from previous specificity attempt)
        const isAlreadyQuoted = query.includes('"')

        if (isAlreadyQuoted) {
            // If already using phrases, try to reduce to fewer, more specific terms
            const quotedPhrases = query.match(/"[^"]+"/g) || []
            if (quotedPhrases.length > 1) {
                // Keep only the longest/most specific phrase
                const longest = quotedPhrases.sort((a, b) => b.length - a.length)[0]
                return longest
            } else {
                // Try removing quotes and using AND logic instead
                const unquoted = query.replace(/"/g, '')
                const words = unquoted.split(/\s+/).filter(word => word.length > 2)
                if (words.length > 1) {
                    return words.slice(0, Math.max(1, Math.floor(words.length / 2))).join(' ')
                }
            }
            // Can't improve further
            return query
        }

        const words = query.toLowerCase().split(/\s+/)
        const meaningfulWords = words.filter(word => !stopWords.includes(word) && word.length > 2)

        // If we can make it more specific, try different approaches
        if (meaningfulWords.length >= 2) {
            // Strategy 1: For many words, try exact phrase matching
            if (meaningfulWords.length >= 4) {
                return `"${meaningfulWords.join(' ')}"`
            }

            // Strategy 2: For 3 words, create overlapping phrases
            if (meaningfulWords.length === 3) {
                return `"${meaningfulWords[0]} ${meaningfulWords[1]}" ${meaningfulWords[2]}`
            }

            // Strategy 3: For 2 words, try exact phrase
            if (meaningfulWords.length === 2) {
                return `"${meaningfulWords.join(' ')}"`
            }
        }

        // If only one meaningful word or can't improve, return original
        return query
    }

    /**
     * Generate fallback queries for when no results are found
     * @param {string} query - Original query
     * @returns {Array} Array of fallback queries to try
     */
    generateFallbackQueries(query) {
        const fallbacks = []

        // Remove common stop words and punctuation
        const stopWords = [
            'what',
            'where',
            'when',
            'how',
            'why',
            'who',
            'which',
            'are',
            'is',
            'was',
            'were',
            'be',
            'been',
            'being',
            'have',
            'has',
            'had',
            'do',
            'does',
            'did',
            'will',
            'would',
            'should',
            'could',
            'can',
            'may',
            'might',
            'must',
            'shall',
            'about',
            'for',
            'with',
            'by',
            'from',
            'at',
            'in',
            'on',
            'to',
            'of',
            'and',
            'or',
            'but',
            'if',
            'then',
            'than',
            'the',
            'a',
            'an',
        ]

        const cleanQuery = query.replace(/[^\w\s]/g, ' ').trim()
        const words = cleanQuery.toLowerCase().split(/\s+/)
        const meaningfulWords = words.filter(word => !stopWords.includes(word) && word.length > 2)

        if (meaningfulWords.length > 0) {
            // Fallback 1: All meaningful words
            if (meaningfulWords.length > 1) {
                fallbacks.push(meaningfulWords.join(' '))
            }

            // Fallback 2: Just the most important words (nouns, proper nouns)
            // Keep words that are likely important (longer words, capitalized words)
            const importantWords = meaningfulWords.filter(word => {
                return (
                    word.length > 4 ||
                    /^[A-Z]/.test(word) ||
                    ['germany', 'project', 'meeting', 'task', 'note', 'goal'].includes(word.toLowerCase())
                )
            })

            if (importantWords.length > 0 && importantWords.length !== meaningfulWords.length) {
                fallbacks.push(importantWords.join(' '))
            }

            // Fallback 3: Individual important words (try each separately)
            if (meaningfulWords.length > 1) {
                const sortedByImportance = meaningfulWords.sort((a, b) => {
                    // Prioritize longer words and capitalized words
                    const scoreA = a.length + (/^[A-Z]/.test(a) ? 5 : 0)
                    const scoreB = b.length + (/^[A-Z]/.test(b) ? 5 : 0)
                    return scoreB - scoreA
                })

                // Try top 2 most important words individually
                fallbacks.push(sortedByImportance[0])
                if (sortedByImportance.length > 1) {
                    fallbacks.push(sortedByImportance[1])
                }
            }
        }

        // Remove duplicates and return
        return [...new Set(fallbacks)].filter(q => q !== query)
    }

    /**
     * Get full note content (for the get_note tool)
     * @param {string} userId - The authenticated user ID
     * @param {string} noteId - Note ID to retrieve
     * @param {string} projectId - Project ID containing the note
     * @returns {Object} Note details with full content
     */
    async getNote(userId, noteId, projectId) {
        await this.ensureInitialized()

        // Verify user has access to this project
        const userProjects = await this.getUserProjects(userId)
        const hasAccess = userProjects.some(p => p.id === projectId)

        if (!hasAccess) {
            throw new Error('User does not have access to this project')
        }

        if (!this.options.database) {
            throw new Error('Database interface not configured')
        }

        // Get note metadata
        const noteDoc = await this.options.database.doc(`noteItems/${projectId}/notes/${noteId}`).get()
        if (!noteDoc.exists) {
            throw new Error('Note not found')
        }

        const noteData = noteDoc.data()

        // Get full note content if available
        let content = ''
        if (this.options.enableNoteContent) {
            try {
                // Try using NoteService first (more robust bucket name resolution)
                let noteContentLoaded = false
                try {
                    const { NoteService } = require('./NoteService')
                    const noteService = new NoteService({
                        database: this.options.database,
                        moment: this.options.moment,
                        isCloudFunction: this.options.isCloudFunction,
                        storageBucket: this.options.storageBucket, // Pass explicit bucket if provided
                    })
                    await noteService.initialize()
                    content = await noteService.getStorageContent(projectId, noteId)
                    noteContentLoaded = true
                    console.log(`SearchService: Loaded note content via NoteService (${content.length} chars)`)
                } catch (noteServiceError) {
                    console.log('SearchService: NoteService method failed, trying fallback:', noteServiceError.message)
                }

                // Fallback to searchHelper.getNoteContent if NoteService failed
                if (!noteContentLoaded && getNoteContent) {
                    content = await getNoteContent(projectId, noteId)
                    console.log(`SearchService: Loaded note content via searchHelper (${content.length} chars)`)
                }
            } catch (error) {
                console.error('SearchService: Failed to load note content:', error.message)
                console.error('SearchService: Error stack:', error.stack)
                content = '[Content could not be loaded]'
            }
        }

        return {
            id: noteId,
            projectId,
            title: noteData.title || 'Untitled Note',
            content,
            createdDate: noteData.created || noteData.createdDate,
            lastEditionDate: noteData.lastEditionDate,
            userId: noteData.userId,
            isPrivate: noteData.isPrivate,
            tags: noteData.tags || [],
            metadata: {
                wordCount: content ? content.split(/\s+/).length : 0,
                characterCount: content ? content.length : 0,
                lastModified: noteData.lastEditionDate ? new Date(noteData.lastEditionDate).toISOString() : null,
            },
        }
    }

    /**
     * Parse search query to extract enhanced search parameters
     * @param {string} query - Original search query
     * @param {string} dateRange - Optional date range filter
     * @returns {Object} Parsed query components
     */
    async parseSearchQuery(query, dateRange) {
        const parsedQuery = {
            originalQuery: query,
            keywords: [],
            mentions: [],
            projects: [],
            dateFilter: null,
        }

        // Validate and sanitize input
        if (!query || typeof query !== 'string') {
            throw new Error('Invalid query: query must be a non-empty string')
        }

        // Normalize query: handle escaped quotes and unicode
        let normalizedQuery = query
            .replace(/\\"/g, '"') // Unescape escaped quotes
            .replace(/\\'/g, "'") // Unescape escaped single quotes
            .trim()
            .substring(0, 500) // Safety: Truncate to 500 chars

        // Extract mentions (@username)
        const mentionMatches = normalizedQuery.match(/@(\w+)/g)
        if (mentionMatches) {
            parsedQuery.mentions = mentionMatches.map(m => m.substring(1))
            // Remove mentions from keywords
            normalizedQuery = normalizedQuery.replace(/@\w+/g, '').trim()
        }

        // Extract project references (#projectname)
        const projectMatches = normalizedQuery.match(/#(\w+)/g)
        if (projectMatches) {
            parsedQuery.projects = projectMatches.map(m => m.substring(1))
            // Remove project refs from keywords
            normalizedQuery = normalizedQuery.replace(/#\w+/g, '').trim()
        }

        // Parse date range
        if (dateRange && this.options.enableDateParsing) {
            parsedQuery.dateFilter = this.parseDateRange(dateRange)
        }

        // Extract quoted phrases first (preserve them)
        const quotedPhrases = []
        const quotePattern = /"([^"]+)"/g
        let match
        while ((match = quotePattern.exec(normalizedQuery)) !== null) {
            quotedPhrases.push(match[1].trim())
        }
        // Remove quoted phrases from query for keyword extraction
        normalizedQuery = normalizedQuery.replace(/"[^"]+"/g, '').trim()

        // Extract remaining keywords (preserve unicode characters)
        // Use a more permissive regex that keeps unicode word characters
        const cleanQuery = normalizedQuery
            .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Remove punctuation but keep unicode letters/numbers
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()

        if (cleanQuery) {
            parsedQuery.keywords = cleanQuery.split(/\s+/).filter(word => word.length > 0)
        }

        // Add quoted phrases as keywords (they're important for exact matching)
        if (quotedPhrases.length > 0) {
            // Add each quoted phrase as a single keyword
            parsedQuery.keywords.push(...quotedPhrases)
        }

        // Ensure we have at least some keywords
        if (parsedQuery.keywords.length === 0 && normalizedQuery.length > 0) {
            // Fallback: use the original query as a single keyword
            parsedQuery.keywords = [normalizedQuery.substring(0, 100)] // Limit length
        }

        return parsedQuery
    }

    /**
     * Parse natural language date ranges
     * @param {string} dateRange - Date range string
     * @returns {Object} Date filter object
     */
    parseDateRange(dateRange) {
        const now = moment()
        const lowerRange = dateRange.toLowerCase().trim()

        let startDate = null
        let endDate = null

        if (lowerRange.includes('today')) {
            startDate = now.startOf('day').valueOf()
            endDate = now.endOf('day').valueOf()
        } else if (lowerRange.includes('yesterday')) {
            startDate = now.subtract(1, 'day').startOf('day').valueOf()
            endDate = now.subtract(1, 'day').endOf('day').valueOf()
        } else if (lowerRange.includes('last week')) {
            startDate = now.subtract(1, 'week').startOf('week').valueOf()
            endDate = now.subtract(1, 'week').endOf('week').valueOf()
        } else if (lowerRange.includes('this week')) {
            startDate = now.startOf('week').valueOf()
            endDate = now.endOf('week').valueOf()
        } else if (lowerRange.includes('last month')) {
            startDate = now.subtract(1, 'month').startOf('month').valueOf()
            endDate = now.subtract(1, 'month').endOf('month').valueOf()
        } else if (lowerRange.includes('this month')) {
            startDate = now.startOf('month').valueOf()
            endDate = now.endOf('month').valueOf()
        }

        return startDate ? { startDate, endDate } : null
    }

    /**
     * Search specific entity type using Algolia
     * @param {string} entityType - Entity type to search
     * @param {Object} parsedQuery - Parsed query components
     * @param {Array} userProjects - User's accessible projects
     * @param {string} projectId - Optional project filter
     * @param {number} limit - Result limit
     * @param {string} userId - User ID for visibility filtering
     * @returns {Array} Search results for this entity type
     */
    async searchEntityType(entityType, parsedQuery, userProjects, projectId, limit, userId) {
        if (!this.algoliaClient || !this.options.enableAlgolia) {
            return []
        }

        const indexName = SEARCH_INDICES[entityType.toUpperCase()]
        if (!indexName) {
            console.warn(`No search index configured for entity type: ${entityType}`)
            return []
        }

        try {
            const index = this.algoliaClient.initIndex(indexName)

            // Build search parameters - ensure keywords are valid
            const keywords = parsedQuery.keywords || []
            if (keywords.length === 0) {
                console.warn(`No keywords available for ${entityType} search`)
                return []
            }

            // Join keywords safely - handle special characters
            const searchQuery = keywords
                .map(kw => kw.trim())
                .filter(kw => kw.length > 0)
                .join(' ')
                .substring(0, 500) // Limit query length to prevent issues

            if (!searchQuery || searchQuery.trim().length === 0) {
                console.warn(`Empty search query for ${entityType} after processing`)
                return []
            }

            const filters = this.buildAlgoliaFilters(userProjects, projectId, parsedQuery, entityType, userId)

            const searchOptions = {
                filters,
                hitsPerPage: Math.min(limit, 50), // Limit per entity type
                attributesToRetrieve: this.getAttributesToRetrieve(entityType),
                attributesToHighlight: this.getAttributesToHighlight(entityType),
                timeout: 5000, // 5 second timeout per search
            }

            const searchResponse = await index.search(searchQuery, searchOptions)

            return searchResponse.hits.map(hit => {
                let cleanId = hit.objectID || hit.id
                // Remove project ID suffix from Algolia objectID (format: noteId + projectId)
                if (hit.objectID && hit.projectId && hit.objectID.endsWith(hit.projectId)) {
                    cleanId = hit.objectID.substring(0, hit.objectID.length - hit.projectId.length)
                    console.log('SearchService: Cleaned note ID', {
                        originalObjectID: hit.objectID,
                        projectId: hit.projectId,
                        cleanedId: cleanId,
                    })
                } else {
                    console.log('SearchService: Note ID not cleaned', {
                        objectID: hit.objectID,
                        projectId: hit.projectId,
                        endsWith: hit.objectID ? hit.objectID.endsWith(hit.projectId) : false,
                        finalId: cleanId,
                    })
                }
                return {
                    id: cleanId,
                    type: entityType,
                    projectId: hit.projectId,
                    title: hit.name || hit.title || hit.displayName || 'Untitled',
                    snippet: this.generateSnippet(hit, parsedQuery, entityType),
                    score: hit._score || 0,
                    highlightResult: hit._highlightResult,
                    metadata: this.extractMetadata(hit, entityType),
                    matchedFields: this.getMatchedFields(hit._highlightResult),
                }
            })
        } catch (error) {
            console.error(`Search failed for ${entityType}:`, {
                error: error.message,
                stack: error.stack,
                query: parsedQuery.keywords?.join(' '),
                entityType,
            })
            // Return empty array instead of throwing to prevent cascading failures
            return []
        }
    }

    /**
     * Build Algolia filters based on search parameters
     * @param {Array} userProjects - User's accessible projects
     * @param {string} projectId - Optional project filter
     * @param {Object} parsedQuery - Parsed query components
     * @param {string} entityType - Entity type being searched
     * @param {string} userId - Current user ID for visibility filtering
     * @returns {string} Algolia filter string
     */
    buildAlgoliaFilters(userProjects, projectId, parsedQuery, entityType, userId) {
        const filters = []
        const FEED_PUBLIC_FOR_ALL = 0 // Public visibility constant

        // Project access filter
        if (projectId) {
            filters.push(`projectId:"${projectId}"`)
        } else {
            const projectFilters = userProjects.map(p => `projectId:"${p.id}"`).join(' OR ')
            if (projectFilters) {
                filters.push(`(${projectFilters})`)
            }
        }

        // Visibility filters (critical for security) - following main app patterns
        switch (entityType) {
            case ENTITY_TYPES.GOALS:
            case ENTITY_TYPES.CHATS:
                // Goals and chats use isPublicFor field
                filters.push(`(isPublicFor:${FEED_PUBLIC_FOR_ALL} OR isPublicFor:${userId})`)
                break
            case ENTITY_TYPES.CONTACTS:
            case ENTITY_TYPES.USERS:
                // Contacts/users use isPrivate field + exclude assistants for users
                filters.push(`(isPrivate:false OR isPublicFor:${userId})`)
                if (entityType === ENTITY_TYPES.USERS) {
                    filters.push('isAssistant:false')
                }
                break
            case ENTITY_TYPES.ASSISTANTS:
                // Assistants are public but marked as isAssistant:true
                filters.push('isAssistant:true')
                filters.push(`(isPrivate:false OR isPublicFor:${userId})`)
                break
            case ENTITY_TYPES.TASKS:
            case ENTITY_TYPES.NOTES:
            default:
                // Tasks and notes use isPrivate field
                filters.push(`(isPrivate:false OR isPublicFor:${userId})`)
                break
        }

        // Date range filter
        if (parsedQuery.dateFilter) {
            const { startDate, endDate } = parsedQuery.dateFilter
            filters.push(`lastEditionDate >= ${startDate} AND lastEditionDate <= ${endDate}`)
        }

        return filters.join(' AND ')
    }

    /**
     * Get attributes to retrieve for each entity type
     * @param {string} entityType - Entity type
     * @returns {Array} Attributes to retrieve
     */
    getAttributesToRetrieve(entityType) {
        const common = ['objectID', 'projectId', 'lastEditionDate']

        switch (entityType) {
            case ENTITY_TYPES.TASKS:
                return [
                    ...common,
                    'name',
                    'description',
                    'done',
                    'userId',
                    'dueDate',
                    'created',
                    'humanReadableId',
                    'humanReadableIdSearchable',
                ]
            case ENTITY_TYPES.NOTES:
                return [...common, 'title', 'content', 'userId', 'created', 'isPrivate']
            case ENTITY_TYPES.GOALS:
                return [...common, 'name', 'description', 'progress', 'ownerId', 'created']
            case ENTITY_TYPES.CONTACTS:
                return [...common, 'displayName', 'email', 'cleanDescription', 'role', 'company']
            case ENTITY_TYPES.CHATS:
                return [...common, 'cleanName', 'type', 'lastEditionDate']
            case ENTITY_TYPES.ASSISTANTS:
                return [...common, 'displayName', 'cleanDescription', 'isAssistant']
            default:
                return common
        }
    }

    /**
     * Get attributes to highlight for each entity type
     * @param {string} entityType - Entity type
     * @returns {Array} Attributes to highlight
     */
    getAttributesToHighlight(entityType) {
        switch (entityType) {
            case ENTITY_TYPES.TASKS:
                return ['name', 'description', 'humanReadableId', 'humanReadableIdSearchable']
            case ENTITY_TYPES.NOTES:
                return ['title', 'content']
            case ENTITY_TYPES.GOALS:
                return ['name', 'description']
            case ENTITY_TYPES.CONTACTS:
            case ENTITY_TYPES.ASSISTANTS:
                return ['displayName', 'cleanDescription', 'role', 'company']
            case ENTITY_TYPES.CHATS:
                return ['cleanName']
            default:
                return []
        }
    }

    /**
     * Generate content snippet for search result
     * @param {Object} hit - Algolia search hit
     * @param {Object} parsedQuery - Parsed query components
     * @param {string} entityType - Entity type
     * @returns {string} Content snippet
     */
    generateSnippet(hit, parsedQuery, entityType) {
        let content = ''

        switch (entityType) {
            case ENTITY_TYPES.TASKS:
                content = hit.description || hit.name || ''
                break
            case ENTITY_TYPES.NOTES:
                content = hit.content || hit.title || ''
                break
            case ENTITY_TYPES.GOALS:
                content = hit.description || hit.name || ''
                break
            case ENTITY_TYPES.CONTACTS:
            case ENTITY_TYPES.ASSISTANTS:
                content = hit.cleanDescription || hit.displayName || ''
                break
            case ENTITY_TYPES.CHATS:
                content = hit.cleanName || ''
                break
            default:
                content = hit.name || hit.title || hit.displayName || ''
        }

        // Generate contextual snippet (first 150 chars with keyword context)
        // IMPORTANT: Using indexOf-based search instead of regex to avoid ReDoS
        // with many keyword alternations (e.g., 8+ keywords cause catastrophic backtracking)
        if (content && content.length > 150) {
            const keywords = parsedQuery.keywords || []
            const contentLower = content.toLowerCase()

            // Find the first keyword match position using safe string search
            let firstMatchPos = -1
            let matchedKeyword = ''
            for (const keyword of keywords) {
                if (keyword && keyword.length > 0) {
                    const pos = contentLower.indexOf(keyword.toLowerCase())
                    if (pos !== -1 && (firstMatchPos === -1 || pos < firstMatchPos)) {
                        firstMatchPos = pos
                        matchedKeyword = keyword
                    }
                }
            }

            if (firstMatchPos !== -1) {
                // Extract context around the match (50 chars before and after)
                const start = Math.max(0, firstMatchPos - 50)
                const end = Math.min(content.length, firstMatchPos + matchedKeyword.length + 50)
                const snippet = content.substring(start, end)
                return (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : '')
            }

            return content.substring(0, 147) + '...'
        }

        return content || '[No content]'
    }

    /**
     * Extract metadata for search result
     * @param {Object} hit - Algolia search hit
     * @param {string} entityType - Entity type
     * @returns {Object} Extracted metadata
     */
    extractMetadata(hit, entityType) {
        const metadata = {
            lastModified: hit.lastEditionDate ? new Date(hit.lastEditionDate).toISOString() : null,
            created: hit.created ? new Date(hit.created).toISOString() : null,
        }

        switch (entityType) {
            case ENTITY_TYPES.TASKS:
                metadata.completed = !!hit.done
                metadata.assignee = hit.userId
                metadata.dueDate = hit.dueDate ? new Date(hit.dueDate).toISOString() : null
                break
            case ENTITY_TYPES.GOALS:
                metadata.progress = hit.progress || 0
                metadata.owner = hit.ownerId
                break
            case ENTITY_TYPES.NOTES:
                metadata.private = !!hit.isPrivate
                metadata.author = hit.userId
                break
            case ENTITY_TYPES.CONTACTS:
            case ENTITY_TYPES.ASSISTANTS:
                metadata.email = hit.email
                metadata.role = hit.role
                metadata.company = hit.company
                metadata.isAssistant = !!hit.isAssistant
                break
        }

        return metadata
    }

    /**
     * Get matched fields from highlight results
     * @param {Object} highlightResult - Algolia highlight result
     * @returns {Array} Matched field names
     */
    getMatchedFields(highlightResult) {
        if (!highlightResult) return []

        return Object.keys(highlightResult).filter(
            field => highlightResult[field] && highlightResult[field].matchLevel === 'full'
        )
    }

    /**
     * Get user's accessible projects
     * @param {string} userId - User ID
     * @returns {Array} List of projects user can access
     */
    async getUserProjects(userId) {
        if (!this.options.database) {
            throw new Error('Database interface not configured')
        }

        const userDoc = await this.options.database.collection('users').doc(userId).get()

        if (!userDoc.exists) {
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const projectIds = userData.projectIds || []

        // Get project details
        const projects = []
        for (const projectId of projectIds) {
            try {
                const projectDoc = await this.options.database.collection('projects').doc(projectId).get()
                if (projectDoc.exists) {
                    const projectData = projectDoc.data()
                    projects.push({
                        id: projectId,
                        name: projectData.name,
                        active: projectData.active,
                        ...projectData,
                    })
                }
            } catch (error) {
                console.warn(`Could not access project ${projectId}:`, error.message)
            }
        }

        return projects
    }

    /**
     * Find note for update using enhanced search with confidence-based auto-selection
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchCriteria - Search parameters
     * @param {Object} options - Search options (autoSelectOnHighConfidence, thresholds, etc.)
     * @returns {Object} Search results with decision and selected match or options
     */
    async findNoteForUpdate(userId, searchCriteria, options = {}) {
        await this.ensureInitialized()

        const {
            autoSelectOnHighConfidence = true,
            highConfidenceThreshold = 600,
            dominanceMargin = 300,
            maxOptionsToShow = 5,
        } = options

        // Find notes using search criteria
        const searchResult = await this.findNotesBySearchCriteria(userId, searchCriteria)
        const matches = searchResult.matches || []

        if (matches.length === 0) {
            return {
                decision: 'no_matches',
                error: searchResult.message || 'No notes found matching the search criteria',
                searchCriteria,
            }
        }

        if (matches.length === 1) {
            return {
                decision: 'single_match',
                selectedMatch: matches[0],
                searchCriteria,
            }
        }

        // Multiple matches - assess confidence for auto-selection
        const topMatch = matches[0]
        const secondMatch = matches[1]
        const confidence = topMatch.matchScore
        const dominance = topMatch.matchScore - secondMatch.matchScore

        if (autoSelectOnHighConfidence && confidence >= highConfidenceThreshold && dominance >= dominanceMargin) {
            return {
                decision: 'auto_select',
                selectedMatch: topMatch,
                confidence,
                reasoning: `Auto-selected "${topMatch.note.title}" with high confidence (${confidence}) over ${
                    matches.length - 1
                } alternatives`,
                alternativeMatches: matches.slice(1),
                searchCriteria,
            }
        }

        return {
            decision: 'present_options',
            allMatches: matches.slice(0, maxOptionsToShow),
            totalMatches: matches.length,
            confidence,
            reasoning: `Found ${matches.length} notes, but confidence (${confidence}) insufficient for auto-selection`,
            searchCriteria,
        }
    }

    /**
     * Find note for update with complete result handling - returns final actionable results
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchCriteria - Search parameters
     * @param {Object} options - Configuration options
     * @returns {Object} Complete result with success flag, selected note, or error details
     */
    async findNoteForUpdateWithResults(userId, searchCriteria, options = {}) {
        await this.ensureInitialized()

        try {
            let searchResult = await this.findNoteForUpdate(userId, searchCriteria, options)

            // Fallback: If no project name was specified and we defaulted to current project (projectId is set),
            // try searching globally (all projects) before giving up.
            if (searchResult.decision === 'no_matches' && !searchCriteria.projectName && searchCriteria.projectId) {
                console.log('SearchService: Initial search in specific project failed. Retrying with global search...')

                const globalCriteria = {
                    ...searchCriteria,
                    projectId: undefined,
                    projectName: undefined,
                }

                const globalSearchResult = await this.findNoteForUpdate(userId, globalCriteria, options)

                if (globalSearchResult.decision !== 'no_matches') {
                    console.log('SearchService: Global search fallback succeeded', {
                        noteId: globalSearchResult.selectedMatch?.note?.id,
                        projectId: globalSearchResult.selectedMatch?.projectId,
                    })
                    searchResult = globalSearchResult
                }
            }

            switch (searchResult.decision) {
                case 'no_matches':
                    return {
                        success: false,
                        error: 'NO_MATCHES',
                        message: searchResult.error,
                        searchCriteria: searchResult.searchCriteria,
                    }

                case 'single_match':
                case 'auto_select':
                    return {
                        success: true,
                        selectedNote: searchResult.selectedMatch.note,
                        projectId: searchResult.selectedMatch.projectId,
                        projectName: searchResult.selectedMatch.projectName,
                        confidence: searchResult.confidence,
                        reasoning: searchResult.reasoning || 'Single match found',
                        isAutoSelected: searchResult.decision === 'auto_select',
                        alternativeMatches: searchResult.alternativeMatches || [],
                        searchCriteria: searchResult.searchCriteria,
                    }

                case 'present_options':
                    // Format options message for user
                    let message = `${searchResult.reasoning}\n\nFound ${searchResult.totalMatches} notes:\n\n`

                    searchResult.allMatches.slice(0, 5).forEach((match, index) => {
                        message += `${index + 1}. "${match.note.title}"`
                        message += ` (Project: ${match.projectName})`

                        // Show confidence indicators
                        const matchConfidence = this.assessConfidence(match.matchScore)
                        message += ` [${matchConfidence} confidence: ${match.matchScore}]\n`

                        if (match.note.content) {
                            const preview = match.note.content.substring(0, 100).replace(/\n/g, ' ')
                            message += `   Preview: ${preview}${match.note.content.length > 100 ? '...' : ''}\n`
                        }
                        message += `   Note ID: ${match.note.id}\n\n`
                    })

                    if (searchResult.allMatches.length > 5) {
                        message += `... and ${searchResult.allMatches.length - 5} more matches.\n\n`
                    }

                    message +=
                        'Please be more specific in your search criteria, or use the exact note ID to update a specific note.'

                    return {
                        success: false,
                        error: 'MULTIPLE_MATCHES',
                        message,
                        confidence: searchResult.confidence,
                        reasoning: searchResult.reasoning,
                        matches: searchResult.allMatches.map(m => ({
                            noteId: m.note.id,
                            noteTitle: m.note.title,
                            projectId: m.projectId,
                            projectName: m.projectName,
                            matchScore: m.matchScore,
                            matchType: m.matchType,
                            confidence: this.assessConfidence(m.matchScore),
                        })),
                        totalMatches: searchResult.totalMatches,
                        searchCriteria: searchResult.searchCriteria,
                    }

                default:
                    return {
                        success: false,
                        error: 'UNKNOWN_DECISION',
                        message: `Unknown decision type: ${searchResult.decision}`,
                        searchCriteria: searchResult.searchCriteria,
                    }
            }
        } catch (error) {
            return {
                success: false,
                error: 'SEARCH_ERROR',
                message: `Search failed: ${error.message}`,
                searchCriteria,
            }
        }
    }

    /**
     * Find notes using flexible search criteria
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchCriteria - Search parameters
     * @returns {Object} Search results with matches array
     */
    async findNotesBySearchCriteria(userId, searchCriteria) {
        await this.ensureInitialized()

        const { noteId, noteTitle, projectName, projectId } = searchCriteria

        // Validate that at least one search criterion is provided
        if (!noteId && !noteTitle && !projectName && !projectId) {
            throw new Error('At least one search criterion is required (noteId, noteTitle, projectName, or projectId)')
        }

        // Get user's accessible projects
        const userProjects = await this.getUserProjects(userId)
        if (userProjects.length === 0) {
            return {
                matches: [],
                searchCriteria,
                message: 'No accessible projects found for user',
            }
        }

        let matches = []

        // If noteId is provided, try direct lookup first
        if (noteId) {
            const directMatch = await this.findNoteById(noteId, userProjects)
            if (directMatch) {
                matches.push({
                    ...directMatch,
                    matchScore: 1000, // Highest priority for direct ID match
                    matchType: 'direct_id',
                })
            }
        }

        // Search by title and project if other criteria provided
        if ((noteTitle || projectName || projectId) && matches.length === 0) {
            const searchMatches = await this.searchNotesByContent(userId, searchCriteria, userProjects)
            matches.push(...searchMatches)
        }

        // Sort by match score (highest first)
        matches.sort((a, b) => b.matchScore - a.matchScore)

        return {
            matches,
            searchCriteria,
            message: matches.length === 0 ? 'No notes found matching the search criteria' : undefined,
        }
    }

    /**
     * Find note by direct ID lookup
     * @param {string} noteId - The note ID
     * @param {Array} userProjects - User's accessible projects
     * @returns {Object|null} Note match or null
     */
    async findNoteById(noteId, userProjects) {
        for (const project of userProjects) {
            try {
                // Clean the note ID in case it has project suffix (from Algolia objectID)
                let cleanNoteId = noteId
                if (noteId && noteId.endsWith(project.id)) {
                    cleanNoteId = noteId.substring(0, noteId.length - project.id.length)
                    console.log('SearchService: Cleaned noteId for direct lookup', {
                        originalNoteId: noteId,
                        projectId: project.id,
                        cleanedNoteId: cleanNoteId,
                    })
                }

                const noteDoc = await this.options.database.doc(`noteItems/${project.id}/notes/${cleanNoteId}`).get()
                if (noteDoc.exists) {
                    const noteData = noteDoc.data()
                    return {
                        note: { ...noteData, id: cleanNoteId }, // Ensure clean ID overrides any corrupted ID from document data
                        projectId: project.id,
                        projectName: project.name,
                    }
                }
            } catch (error) {
                console.warn(`Error checking note ${noteId} in project ${project.id}:`, error.message)
            }
        }
        return null
    }

    /**
     * Search notes by content using Algolia
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchCriteria - Search parameters
     * @param {Array} userProjects - User's accessible projects
     * @returns {Array} Array of note matches with scores
     */
    async searchNotesByContent(userId, searchCriteria, userProjects) {
        const { noteTitle, projectName, projectId } = searchCriteria

        // Build search query
        let query = noteTitle || ''

        // Add project filter if specified
        let filters = [`(isPrivate:false OR isPublicFor:${userId})`]

        if (projectId) {
            filters.push(`projectId:${projectId}`)
        } else if (projectName) {
            // Search for projects matching the name first
            const matchingProjectIds = userProjects
                .filter(p => p.name.toLowerCase().includes(projectName.toLowerCase()))
                .map(p => p.id)

            if (matchingProjectIds.length > 0) {
                filters.push(`(${matchingProjectIds.map(id => `projectId:${id}`).join(' OR ')})`)
            }
        }

        try {
            const index = this.algoliaClient.initIndex(SEARCH_INDICES.NOTES)
            const searchResults = await index.search(query, {
                filters: filters.join(' AND '),
                hitsPerPage: 20,
                attributesToRetrieve: ['objectID', 'title', 'content', 'projectId', 'userId', 'lastEditionDate'],
            })

            const matches = []
            const projectsMap = new Map(userProjects.map(p => [p.id, p]))

            for (const hit of searchResults.hits) {
                const project = projectsMap.get(hit.projectId)
                if (!project) continue

                let matchScore = 100 // Base score

                // Score based on title match quality
                if (noteTitle && hit.title) {
                    const titleLower = hit.title.toLowerCase()
                    const searchTitleLower = noteTitle.toLowerCase()

                    if (titleLower === searchTitleLower) {
                        matchScore += 500 // Exact title match
                    } else if (titleLower.includes(searchTitleLower)) {
                        matchScore += 300 // Partial title match
                    } else if (searchTitleLower.includes(titleLower)) {
                        matchScore += 200 // Title is substring of search
                    }
                }

                // Score based on project match
                if (projectName && project.name) {
                    const projectLower = project.name.toLowerCase()
                    const searchProjectLower = projectName.toLowerCase()

                    if (projectLower === searchProjectLower) {
                        matchScore += 200 // Exact project match
                    } else if (projectLower.includes(searchProjectLower)) {
                        matchScore += 100 // Partial project match
                    }
                }

                // Clean the note ID from Algolia objectID
                let cleanId = hit.objectID
                if (hit.objectID && hit.projectId && hit.objectID.endsWith(hit.projectId)) {
                    cleanId = hit.objectID.substring(0, hit.objectID.length - hit.projectId.length)
                    console.log('SearchService: Cleaned note ID from Algolia search', {
                        originalObjectID: hit.objectID,
                        projectId: hit.projectId,
                        cleanedId: cleanId,
                    })
                }

                matches.push({
                    note: { ...hit, id: cleanId }, // Ensure clean ID overrides any corrupted ID from hit data
                    projectId: hit.projectId,
                    projectName: project.name,
                    matchScore,
                    matchType: 'content_search',
                })
            }

            return matches
        } catch (error) {
            console.warn('Algolia search failed, falling back to Firestore:', error.message)
            return []
        }
    }

    /**
     * Assess confidence level from match score
     * @param {number} score - Match score
     * @returns {string} Confidence level
     */
    assessConfidence(score) {
        if (score >= 800) return 'high'
        if (score >= 500) return 'medium'
        if (score >= 200) return 'low'
        return 'very-low'
    }

    /**
     * Health check for the service
     * @returns {Object} Service status
     */
    async healthCheck() {
        try {
            await this.ensureInitialized()
            return {
                status: 'healthy',
                initialized: this.initialized,
                algoliaClient: !!this.algoliaClient,
                dependencies: {
                    algoliasearch: !!algoliasearch,
                    moment: !!moment,
                    getAlgoliaClient: !!getAlgoliaClient,
                    getNoteContent: !!getNoteContent,
                },
                config: {
                    enableAlgolia: this.options.enableAlgolia,
                    enableNoteContent: this.options.enableNoteContent,
                    enableDateParsing: this.options.enableDateParsing,
                    environment: this.options.isCloudFunction
                        ? 'cloud-function'
                        : this.options.isReactNative
                        ? 'react-native'
                        : this.options.isWeb
                        ? 'web'
                        : 'unknown',
                },
            }
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                initialized: this.initialized,
            }
        }
    }
}

// Export for CommonJS (Node.js environment)
module.exports = {
    SearchService,
    ENTITY_TYPES,
    SEARCH_INDICES,
    default: SearchService,
}
