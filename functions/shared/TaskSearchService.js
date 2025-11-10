/**
 * TaskSearchService - Universal task search and discovery service
 *
 * This service provides flexible task searching capabilities that work across
 * all platforms and contexts, supporting partial matching on various criteria:
 * - Task ID (direct lookup)
 * - Task name (partial matching)
 * - Project name (partial matching)
 * - Project ID (direct lookup)
 */

class TaskSearchService {
    constructor(options = {}) {
        this.options = {
            // Database interface (Firestore admin, client, etc.)
            database: null,

            // Environment-specific options
            isCloudFunction: typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR !== undefined,
            isReactNative: typeof navigator !== 'undefined' && navigator.product === 'ReactNative',
            isWeb: typeof window !== 'undefined',

            // Override any defaults
            ...options,
        }

        this.initialized = false
        this.projectService = null
    }

    /**
     * Initialize the service
     */
    async initialize() {
        if (this.initialized) return

        if (!this.options.database) {
            throw new Error('Database interface is required for TaskSearchService')
        }

        // Initialize ProjectService for proper project filtering
        if (typeof require !== 'undefined') {
            const { ProjectService } = require('./ProjectService')
            this.projectService = new ProjectService({
                database: this.options.database,
            })
            await this.projectService.initialize()
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
     * Main search method - find tasks using flexible search criteria
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchCriteria - Search parameters
     * @param {string} [searchCriteria.taskId] - Direct task ID
     * @param {string} [searchCriteria.taskName] - Full or partial task name
     * @param {string} [searchCriteria.projectName] - Full or partial project name
     * @param {string} [searchCriteria.projectId] - Direct project ID
     * @returns {Object} Search results with matches array
     */
    async findTasksBySearchCriteria(userId, searchCriteria) {
        await this.ensureInitialized()

        const { taskId, taskName, projectName, projectId } = searchCriteria

        // Validate that at least one search criterion is provided
        if (!taskId && !taskName && !projectName && !projectId) {
            throw new Error('At least one search criterion is required (taskId, taskName, projectName, or projectId)')
        }

        // Validate search criteria quality
        const validationError = this.validateSearchCriteria(searchCriteria)
        if (validationError) {
            throw new Error(validationError)
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

        // If taskId is provided, try direct lookup first
        if (taskId) {
            const directMatch = await this.findTaskById(taskId, userProjects)
            if (directMatch) {
                matches.push({
                    ...directMatch,
                    matchScore: 1000, // Highest priority for direct ID match
                    matchType: 'direct_id',
                })
            }
        }

        // If no direct match or additional criteria provided, do flexible search
        if (matches.length === 0 || taskName || projectName || projectId) {
            const flexibleMatches = await this.searchTasksFlexibly(userId, userProjects, searchCriteria)
            matches = matches.concat(flexibleMatches)
        }

        // Sort by match score (highest first)
        matches.sort((a, b) => b.matchScore - a.matchScore)

        // Remove duplicates (in case direct ID match was also found in flexible search)
        const uniqueMatches = matches.reduce((unique, match) => {
            const existing = unique.find(u => u.task.id === match.task.id && u.projectId === match.projectId)
            if (!existing) {
                unique.push(match)
            }
            return unique
        }, [])

        // Apply result limits and quality filtering
        const filteredMatches = this.filterAndLimitResults(uniqueMatches, searchCriteria)

        return {
            matches: filteredMatches,
            searchCriteria,
            totalFound: filteredMatches.length,
            totalBeforeFiltering: uniqueMatches.length,
        }
    }

    /**
     * Enhanced task search specifically for update operations
     * Includes confidence-based auto-selection logic
     *
     * @param {string} userId - The authenticated user ID
     * @param {Object} searchCriteria - Search parameters
     * @param {Object} options - Configuration options
     * @returns {Object} Enhanced result with decision logic
     */
    async findTaskForUpdate(userId, searchCriteria, options = {}) {
        await this.ensureInitialized()

        // Configuration with defaults
        const config = {
            autoSelectOnHighConfidence: true,
            highConfidenceThreshold: 800,
            dominanceMargin: 300,
            requireManualSelection: false,
            maxOptionsToShow: 5,
            ...options,
        }

        // Get all matches using existing search logic
        const searchResult = await this.findTasksBySearchCriteria(userId, searchCriteria)
        const matches = searchResult.matches || []

        // No matches case
        if (matches.length === 0) {
            return {
                decision: 'no_matches',
                selectedMatch: null,
                allMatches: [],
                confidence: 'none',
                reasoning: 'No tasks found matching the search criteria',
                shouldProceedWithUpdate: false,
                searchCriteria,
                error: this.buildNoMatchesError(searchCriteria),
            }
        }

        // Single match case
        if (matches.length === 1) {
            const match = matches[0]
            const confidence = this.assessConfidence(match.matchScore)

            return {
                decision: 'auto_select',
                selectedMatch: match,
                allMatches: matches,
                confidence,
                reasoning: `Single match found: ${match.matchType} (score: ${match.matchScore})`,
                shouldProceedWithUpdate: true,
                searchCriteria,
            }
        }

        // Multiple matches - apply confidence logic
        return this.assessMultipleMatches(matches, config, searchCriteria)
    }

    /**
     * Assess multiple matches and determine if auto-selection is appropriate
     */
    assessMultipleMatches(matches, config, searchCriteria) {
        // Sort matches by score (highest first)
        const sortedMatches = [...matches].sort((a, b) => b.matchScore - a.matchScore)
        const topMatch = sortedMatches[0]
        const secondMatch = sortedMatches[1]

        // Check if manual selection is forced
        if (config.requireManualSelection) {
            return {
                decision: 'present_options',
                selectedMatch: null,
                allMatches: sortedMatches.slice(0, config.maxOptionsToShow),
                confidence: 'manual_required',
                reasoning: 'Manual selection required by configuration',
                shouldProceedWithUpdate: false,
                searchCriteria,
            }
        }

        // Check if auto-selection is disabled
        if (!config.autoSelectOnHighConfidence) {
            return this.buildPresentOptionsResult(sortedMatches, config, searchCriteria, 'Auto-selection disabled')
        }

        // High confidence auto-selection logic
        const hasHighConfidenceMatch = topMatch.matchScore >= config.highConfidenceThreshold

        if (hasHighConfidenceMatch) {
            // Check if it's a dominant match (significantly better than others)
            const scoreDifference = secondMatch ? topMatch.matchScore - secondMatch.matchScore : 1000
            const isDominant = scoreDifference >= config.dominanceMargin

            if (isDominant) {
                return {
                    decision: 'auto_select',
                    selectedMatch: topMatch,
                    allMatches: sortedMatches,
                    confidence: this.assessConfidence(topMatch.matchScore),
                    reasoning: `Auto-selected dominant match: ${topMatch.matchType} (score: ${topMatch.matchScore}, ${scoreDifference} points ahead)`,
                    shouldProceedWithUpdate: true,
                    searchCriteria,
                    alternativeMatches: sortedMatches.slice(1, 4), // Show a few alternatives for transparency
                }
            } else {
                // Multiple high-confidence matches - present options
                return this.buildPresentOptionsResult(
                    sortedMatches,
                    config,
                    searchCriteria,
                    `Multiple high-confidence matches found (top score: ${topMatch.matchScore})`
                )
            }
        }

        // All matches have low confidence - present options
        return this.buildPresentOptionsResult(
            sortedMatches,
            config,
            searchCriteria,
            `Low confidence matches (highest score: ${topMatch.matchScore})`
        )
    }

    /**
     * Build a "present options" result
     */
    buildPresentOptionsResult(sortedMatches, config, searchCriteria, reasoning) {
        return {
            decision: 'present_options',
            selectedMatch: null,
            allMatches: sortedMatches.slice(0, config.maxOptionsToShow),
            confidence: this.assessConfidence(sortedMatches[0]?.matchScore || 0),
            reasoning,
            shouldProceedWithUpdate: false,
            searchCriteria,
            totalMatches: sortedMatches.length,
        }
    }

    /**
     * Assess confidence level based on match score
     */
    assessConfidence(score) {
        if (score >= 800) return 'high'
        if (score >= 200) return 'medium'
        if (score >= 50) return 'low'
        return 'very_low'
    }

    /**
     * Build error message for no matches case
     */
    buildNoMatchesError(searchCriteria) {
        const { taskId, taskName, projectName, projectId } = searchCriteria
        const criteria = []

        if (taskId) criteria.push(`taskId: ${taskId}`)
        if (taskName) criteria.push(`taskName: "${taskName}"`)
        if (projectName) criteria.push(`projectName: "${projectName}"`)
        if (projectId) criteria.push(`projectId: ${projectId}`)

        return `No tasks found matching search criteria: ${criteria.join(
            ', '
        )}. Try being more specific or check the task/project names.`
    }

    /**
     * Validate search criteria for quality and meaningfulness
     */
    validateSearchCriteria(searchCriteria) {
        const { taskId, taskName, projectName, projectId } = searchCriteria

        // Validate task name
        if (taskName !== undefined) {
            if (typeof taskName !== 'string') {
                return 'taskName must be a string'
            }
            const trimmed = taskName.trim()
            if (trimmed.length < 2) {
                return 'taskName must be at least 2 characters long'
            }
            if (trimmed.length > 100) {
                return 'taskName must be less than 100 characters'
            }
            // Check for overly generic terms
            const genericTerms = ['task', 'todo', 'item', 'work', 'project', 'a', 'an', 'the', 'do', 'get']
            if (genericTerms.includes(trimmed.toLowerCase())) {
                return `taskName "${trimmed}" is too generic. Please be more specific.`
            }
        }

        // Validate project name
        if (projectName !== undefined) {
            if (typeof projectName !== 'string') {
                return 'projectName must be a string'
            }
            const trimmed = projectName.trim()
            if (trimmed.length < 2) {
                return 'projectName must be at least 2 characters long'
            }
            if (trimmed.length > 100) {
                return 'projectName must be less than 100 characters'
            }
        }

        // Validate task ID
        if (taskId !== undefined) {
            if (typeof taskId !== 'string') {
                return 'taskId must be a string'
            }
            const trimmed = taskId.trim()
            if (trimmed.length === 0) {
                return 'taskId cannot be empty'
            }
        }

        // Validate project ID
        if (projectId !== undefined) {
            if (typeof projectId !== 'string') {
                return 'projectId must be a string'
            }
            const trimmed = projectId.trim()
            if (trimmed.length === 0) {
                return 'projectId cannot be empty'
            }
        }

        return null // No validation errors
    }

    /**
     * Filter results by quality and apply limits
     */
    filterAndLimitResults(matches, searchCriteria) {
        const { taskId } = searchCriteria

        // If searching by direct ID, return at most 1 result (exact match)
        if (taskId) {
            const exactMatch = matches.find(m => m.task.id === taskId)
            return exactMatch ? [exactMatch] : []
        }

        // Group matches by relevance tiers
        const excellentMatches = matches.filter(m => m.matchScore >= 200) // Exact/near exact matches
        const goodMatches = matches.filter(m => m.matchScore >= 100 && m.matchScore < 200) // Strong partial matches
        const fairMatches = matches.filter(m => m.matchScore >= 50 && m.matchScore < 100) // Weaker matches

        // Prioritize higher quality matches, but allow some lower quality if needed
        let resultMatches = []

        if (excellentMatches.length > 0) {
            // If we have excellent matches, prefer those
            resultMatches = excellentMatches.slice(0, 5) // Max 5 excellent matches

            // Add a few good matches if we have room
            if (resultMatches.length < 3) {
                resultMatches = resultMatches.concat(goodMatches.slice(0, 3 - resultMatches.length))
            }
        } else if (goodMatches.length > 0) {
            // No excellent matches, use good matches
            resultMatches = goodMatches.slice(0, 10) // Max 10 good matches
        } else {
            // Only fair matches available
            resultMatches = fairMatches.slice(0, 15) // Max 15 fair matches
        }

        // Final limit to prevent overwhelming results
        return resultMatches.slice(0, 20) // Absolute maximum of 20 results
    }

    /**
     * Get all projects accessible to user
     * Uses ProjectService to filter out archived, template, guide, and inactive projects
     */
    async getUserProjects(userId) {
        await this.ensureInitialized()

        // Use ProjectService for proper filtering (active, non-archived, non-community by default)
        if (this.projectService) {
            return await this.projectService.getUserProjects(userId, {
                includeArchived: false,
                includeCommunity: false,
                activeOnly: true,
            })
        }

        // Fallback to direct database access if ProjectService not available
        const db = this.options.database
        const userDoc = await db.collection('users').doc(userId).get()

        if (!userDoc.exists) {
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const projectIds = userData.projectIds || []

        // Get project details
        const projects = []
        for (const projectId of projectIds) {
            try {
                const projectDoc = await db.collection('projects').doc(projectId).get()
                if (projectDoc.exists) {
                    projects.push({
                        id: projectId,
                        ...projectDoc.data(),
                    })
                }
            } catch (error) {
                console.warn(`Could not access project ${projectId}:`, error.message)
            }
        }

        return projects
    }

    /**
     * Find task by direct ID lookup
     */
    async findTaskById(taskId, userProjects) {
        const db = this.options.database

        for (const project of userProjects) {
            try {
                const taskDoc = await db.doc(`items/${project.id}/tasks/${taskId}`).get()
                if (taskDoc.exists) {
                    return {
                        task: { id: taskId, ...taskDoc.data() },
                        projectId: project.id,
                        projectName: project.name,
                    }
                }
            } catch (error) {
                // Continue searching in other projects
                continue
            }
        }

        return null
    }

    /**
     * Search tasks using flexible criteria across user's projects
     */
    async searchTasksFlexibly(userId, userProjects, searchCriteria) {
        const { taskName, projectName, projectId } = searchCriteria
        const db = this.options.database
        const matches = []

        // Filter projects based on search criteria
        let targetProjects = userProjects

        if (projectId) {
            // Direct project ID lookup
            targetProjects = userProjects.filter(p => p.id === projectId)
        } else if (projectName) {
            // Partial project name matching
            const lowerProjectName = projectName.toLowerCase()
            targetProjects = userProjects.filter(p => p.name && p.name.toLowerCase().includes(lowerProjectName))
        }

        // Search tasks in filtered projects with optimized queries
        for (const project of targetProjects) {
            try {
                // Use optimized search strategy to avoid full collection scans
                const projectMatches = await this.searchTasksInProject(project, searchCriteria)
                matches.push(...projectMatches)
            } catch (error) {
                console.warn(`Could not search tasks in project ${project.id}:`, error.message)
                continue
            }
        }

        return matches
    }

    /**
     * Optimized task search within a single project
     * Searches both task name and humanReadableId with fuzzy matching
     */
    async searchTasksInProject(project, searchCriteria) {
        const { taskName } = searchCriteria
        const db = this.options.database
        const matches = []
        const MAX_RESULTS_PER_PROJECT = 100 // Prevent excessive results

        try {
            let query = db.collection(`items/${project.id}/tasks`)

            if (taskName) {
                console.log(`Searching for "${taskName}" in project ${project.id}`)

                // Strategy 1: Try exact matches on both name and humanReadableId
                const exactNameResults = await query.where('name', '==', taskName).limit(10).get()
                const exactIdResults = await query.where('humanReadableId', '==', taskName).limit(10).get()

                // Process exact name matches
                exactNameResults.forEach(taskDoc => {
                    const task = { id: taskDoc.id, ...taskDoc.data() }
                    const matchScore = this.scoreMatch(task, project, searchCriteria)

                    if (matchScore >= 50) {
                        matches.push({
                            task,
                            projectId: project.id,
                            projectName: project.name,
                            matchScore,
                            matchType: 'exact_name',
                        })
                    }
                })

                // Process exact humanReadableId matches
                exactIdResults.forEach(taskDoc => {
                    const task = { id: taskDoc.id, ...taskDoc.data() }
                    // Don't add duplicates
                    if (!matches.find(m => m.task.id === task.id)) {
                        matches.push({
                            task,
                            projectId: project.id,
                            projectName: project.name,
                            matchScore: 1000, // High score for exact ID match
                            matchType: 'exact_id',
                        })
                    }
                })

                // Strategy 2: Try fuzzy ID matching if no exact matches
                if (matches.length === 0) {
                    console.log(`No exact matches, trying fuzzy search for "${taskName}"`)

                    // Generate fuzzy variations of the search term
                    const fuzzyVariations = this.generateFuzzyIdVariations(taskName)

                    for (const variation of fuzzyVariations) {
                        if (variation !== taskName) {
                            // Don't repeat exact searches
                            const fuzzyResults = await query.where('humanReadableId', '==', variation).limit(5).get()

                            fuzzyResults.forEach(taskDoc => {
                                const task = { id: taskDoc.id, ...taskDoc.data() }
                                if (!matches.find(m => m.task.id === task.id)) {
                                    matches.push({
                                        task,
                                        projectId: project.id,
                                        projectName: project.name,
                                        matchScore: 800, // High score for fuzzy ID match
                                        matchType: 'fuzzy_id',
                                    })
                                }
                            })
                        }
                    }
                }

                // Strategy 3: Limited scan for partial matches if still no results
                if (matches.length === 0) {
                    console.log(`No fuzzy matches, doing limited scan for "${taskName}"`)

                    const limitedQuery = query.limit(MAX_RESULTS_PER_PROJECT)
                    const limitedResults = await limitedQuery.get()

                    limitedResults.forEach(taskDoc => {
                        const task = { id: taskDoc.id, ...taskDoc.data() }
                        const matchScore = this.scoreMatch(task, project, searchCriteria)

                        if (matchScore >= 50) {
                            matches.push({
                                task,
                                projectId: project.id,
                                projectName: project.name,
                                matchScore,
                                matchType: this.getMatchType(task, project, searchCriteria),
                            })
                        }
                    })
                }
            } else {
                // If no taskName criteria, do a limited scan
                const limitedQuery = query.limit(MAX_RESULTS_PER_PROJECT)
                const limitedResults = await limitedQuery.get()

                limitedResults.forEach(taskDoc => {
                    const task = { id: taskDoc.id, ...taskDoc.data() }
                    const matchScore = this.scoreMatch(task, project, searchCriteria)

                    if (matchScore >= 50) {
                        matches.push({
                            task,
                            projectId: project.id,
                            projectName: project.name,
                            matchScore,
                            matchType: this.getMatchType(task, project, searchCriteria),
                        })
                    }
                })
            }
        } catch (error) {
            console.warn(`Optimized search failed in project ${project.id}:`, error.message)
            // Fallback: don't do anything, return empty matches
        }

        return matches
    }

    /**
     * Generate fuzzy variations of a potential task ID
     * Examples: "at56" -> ["at-56", "AT-56", "at56", "AT56"]
     */
    generateFuzzyIdVariations(searchTerm) {
        if (!searchTerm || typeof searchTerm !== 'string') return []

        const variations = new Set()
        const trimmed = searchTerm.trim()

        // Add the original term
        variations.add(trimmed)
        variations.add(trimmed.toUpperCase())
        variations.add(trimmed.toLowerCase())

        // Pattern 1: Add hyphen between letters and numbers (at56 -> at-56)
        const letterNumberPattern = /^([a-zA-Z]+)(\d+)$/
        const letterNumberMatch = trimmed.match(letterNumberPattern)
        if (letterNumberMatch) {
            const [, letters, numbers] = letterNumberMatch
            variations.add(`${letters}-${numbers}`)
            variations.add(`${letters.toUpperCase()}-${numbers}`)
            variations.add(`${letters.toLowerCase()}-${numbers}`)
        }

        // Pattern 2: Remove hyphens (at-56 -> at56)
        if (trimmed.includes('-')) {
            const withoutHyphen = trimmed.replace(/-/g, '')
            variations.add(withoutHyphen)
            variations.add(withoutHyphen.toUpperCase())
            variations.add(withoutHyphen.toLowerCase())
        }

        // Pattern 3: Common prefix variations (task74 -> task-74, t74 -> t-74)
        const prefixPattern = /^([a-zA-Z]{1,10})(\d+)$/
        const prefixMatch = trimmed.match(prefixPattern)
        if (prefixMatch) {
            const [, prefix, numbers] = prefixMatch
            variations.add(`${prefix}-${numbers}`)
            variations.add(`${prefix.toUpperCase()}-${numbers}`)
            variations.add(`${prefix.toLowerCase()}-${numbers}`)
        }

        // Pattern 4: Zero-padding variations (at5 -> at-05, at005)
        const zeroPadPattern = /^([a-zA-Z]+)-?(\d{1,2})$/
        const zeroPadMatch = trimmed.match(zeroPadPattern)
        if (zeroPadMatch) {
            const [, letters, numbers] = zeroPadMatch
            const paddedNumbers = numbers.padStart(2, '0')
            const tripleNumbers = numbers.padStart(3, '0')

            variations.add(`${letters}-${paddedNumbers}`)
            variations.add(`${letters.toUpperCase()}-${paddedNumbers}`)
            variations.add(`${letters}-${tripleNumbers}`)
            variations.add(`${letters.toUpperCase()}-${tripleNumbers}`)
        }

        console.log(`Generated fuzzy variations for "${searchTerm}":`, Array.from(variations))
        return Array.from(variations)
    }

    /**
     * Check if a string looks like a task ID (for optimized searching)
     */
    looksLikeTaskId(str) {
        if (!str || typeof str !== 'string') return false

        // Common task ID patterns:
        // AT-74, PROJ-123, ABC-456, at56, task123, etc.
        const taskIdPatterns = [
            /^[A-Z]{1,6}-\d{1,6}$/i, // AT-74, PROJ-123
            /^[A-Z]{1,6}\d{1,6}$/i, // AT74, PROJ123
            /^task\d{1,6}$/i, // task123
            /^t\d{1,6}$/i, // t123
        ]

        const trimmed = str.trim()
        return taskIdPatterns.some(pattern => pattern.test(trimmed))
    }

    /**
     * Score how well a task matches the search criteria
     * Higher scores = better matches
     */
    scoreMatch(task, project, searchCriteria) {
        let score = 0
        let hasActualMatch = false
        const { taskId, taskName, projectName, projectId } = searchCriteria

        // Direct ID matching (highest priority)
        if (taskId && task.id === taskId) {
            score += 1000 // Perfect match
            hasActualMatch = true
        }

        // Project matching
        if (projectId && project.id === projectId) {
            score += 100 // Exact project ID match
            hasActualMatch = true
        } else if (projectName && project.name) {
            const lowerProjectName = projectName.toLowerCase().trim()
            const lowerTaskProjectName = project.name.toLowerCase()

            if (lowerTaskProjectName === lowerProjectName) {
                score += 80 // Exact project name match
                hasActualMatch = true
            } else if (lowerTaskProjectName.includes(lowerProjectName)) {
                score += 50 // Partial project name match
                hasActualMatch = true
            }
        }

        // Task name matching
        if (taskName && task.name) {
            const lowerTaskName = taskName.toLowerCase().trim()
            const lowerActualName = task.name.toLowerCase()

            if (lowerActualName === lowerTaskName) {
                score += 200 // Exact task name match
                hasActualMatch = true
            } else if (lowerActualName.includes(lowerTaskName)) {
                score += 100 // Partial task name match
                hasActualMatch = true
            } else if (this.fuzzyMatch(lowerActualName, lowerTaskName)) {
                score += 30 // Fuzzy match (reduced from 50)
                hasActualMatch = true
            }
        }

        // Human readable ID matching (high priority)
        if (taskName && task.humanReadableId) {
            const lowerTaskName = taskName.toLowerCase().trim()
            const lowerReadableId = task.humanReadableId.toLowerCase()

            if (lowerReadableId === lowerTaskName) {
                score += 500 // Exact human readable ID match
                hasActualMatch = true
            } else if (this.fuzzyIdMatch(lowerReadableId, lowerTaskName)) {
                score += 300 // Fuzzy human readable ID match
                hasActualMatch = true
            }
        }

        // Only add completion bonus if there's an actual match with search criteria
        if (hasActualMatch && !task.completed) {
            score += 5 // Small bonus for incomplete tasks (reduced from 10)
        }

        // If no search criteria provided, give small score to all tasks (for direct ID lookups)
        if (!taskId && !taskName && !projectName && !projectId) {
            score = 1 // Very low score for "match all" scenarios
        }

        return score
    }

    /**
     * Determine the type of match for user feedback
     */
    getMatchType(task, project, searchCriteria) {
        const { taskName, projectName, projectId } = searchCriteria

        if (projectId && project.id === projectId) {
            if (taskName && task.name && task.name.toLowerCase() === taskName.toLowerCase()) {
                return 'exact_match'
            }
            return 'project_exact_task_partial'
        }

        if (taskName && task.name && task.name.toLowerCase() === taskName.toLowerCase()) {
            return 'task_exact'
        }

        return 'partial_match'
    }

    /**
     * Simple fuzzy matching for typos and variations
     */
    fuzzyMatch(text1, text2) {
        // Only do fuzzy matching for strings of reasonable length
        if (text1.length < 3 || text2.length < 3) {
            return false
        }

        // Require higher similarity for meaningful matches
        const similarity = this.calculateSimilarity(text1, text2)
        return similarity > 0.8 // 80% similarity threshold (increased from 60%)
    }

    /**
     * Fuzzy matching specifically for task IDs
     * Examples: "at-56" matches "at56", "AT56", "at-056"
     */
    fuzzyIdMatch(id1, id2) {
        if (!id1 || !id2) return false

        // Generate variations for both IDs and check for matches
        const variations1 = this.generateFuzzyIdVariations(id1)
        const variations2 = this.generateFuzzyIdVariations(id2)

        // Check if any variation of id1 matches any variation of id2
        for (const var1 of variations1) {
            if (variations2.includes(var1)) {
                return true
            }
        }

        return false
    }

    /**
     * Calculate text similarity (Levenshtein distance based)
     */
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2
        const shorter = str1.length > str2.length ? str2 : str1

        if (longer.length === 0) return 1.0

        const distance = this.levenshteinDistance(longer, shorter)
        return (longer.length - distance) / longer.length
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    levenshteinDistance(str1, str2) {
        const matrix = []

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i]
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1]
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1 // deletion
                    )
                }
            }
        }

        return matrix[str2.length][str1.length]
    }
}

// Export for CommonJS (Node.js environment)
module.exports = TaskSearchService
