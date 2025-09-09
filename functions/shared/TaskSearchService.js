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
    }

    /**
     * Initialize the service
     */
    async initialize() {
        if (this.initialized) return

        if (!this.options.database) {
            throw new Error('Database interface is required for TaskSearchService')
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

        return {
            matches: uniqueMatches,
            searchCriteria,
            totalFound: uniqueMatches.length,
        }
    }

    /**
     * Get all projects accessible to user
     */
    async getUserProjects(userId) {
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

        // Search tasks in filtered projects
        for (const project of targetProjects) {
            try {
                const tasksQuery = await db.collection(`items/${project.id}/tasks`).get()

                tasksQuery.forEach(taskDoc => {
                    const task = { id: taskDoc.id, ...taskDoc.data() }
                    const matchScore = this.scoreMatch(task, project, searchCriteria)

                    if (matchScore > 0) {
                        matches.push({
                            task,
                            projectId: project.id,
                            projectName: project.name,
                            matchScore,
                            matchType: this.getMatchType(task, project, searchCriteria),
                        })
                    }
                })
            } catch (error) {
                console.warn(`Could not search tasks in project ${project.id}:`, error.message)
                continue
            }
        }

        return matches
    }

    /**
     * Score how well a task matches the search criteria
     * Higher scores = better matches
     */
    scoreMatch(task, project, searchCriteria) {
        let score = 0
        const { taskName, projectName, projectId } = searchCriteria

        // Project matching
        if (projectId && project.id === projectId) {
            score += 100 // Exact project ID match
        } else if (projectName && project.name) {
            const lowerProjectName = projectName.toLowerCase()
            const lowerTaskProjectName = project.name.toLowerCase()

            if (lowerTaskProjectName === lowerProjectName) {
                score += 80 // Exact project name match
            } else if (lowerTaskProjectName.includes(lowerProjectName)) {
                score += 50 // Partial project name match
            }
        }

        // Task name matching
        if (taskName && task.name) {
            const lowerTaskName = taskName.toLowerCase()
            const lowerActualName = task.name.toLowerCase()

            if (lowerActualName === lowerTaskName) {
                score += 200 // Exact task name match
            } else if (lowerActualName.includes(lowerTaskName)) {
                score += 150 // Partial task name match
            } else if (this.fuzzyMatch(lowerActualName, lowerTaskName)) {
                score += 50 // Fuzzy match
            }
        }

        // Boost score for tasks that aren't completed (more likely to be updated)
        if (!task.completed) {
            score += 10
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
        // Simple fuzzy matching - can be enhanced with more sophisticated algorithms
        const similarity = this.calculateSimilarity(text1, text2)
        return similarity > 0.6 // 60% similarity threshold
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
