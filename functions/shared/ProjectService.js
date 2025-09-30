'use strict'

class ProjectService {
    constructor(options = {}) {
        this.options = options
    }

    async initialize() {
        if (!this.options.database) {
            throw new Error('ProjectService requires a database interface')
        }
    }

    /**
     * Get projects accessible to user, active by default
     * @param {string} userId
     * @param {Object} options
     * @param {boolean} options.includeArchived - include archived projects
     * @param {boolean} options.includeCommunity - include template/guide projects
     * @param {boolean} options.activeOnly - filter by project.active flag (default true)
     * @returns {Promise<Array>} list of project objects with type metadata
     */
    async getUserProjects(userId, options = {}) {
        const includeArchived = options.includeArchived === true
        const includeCommunity = options.includeCommunity === true
        const activeOnly = options.activeOnly !== false // default true

        const db = this.options.database

        const userDoc = await db.collection('users').doc(userId).get()
        if (!userDoc.exists) {
            throw new Error('User not found')
        }

        const userData = userDoc.data()
        const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
        const archivedProjectIds = Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : []
        const templateProjectIds = Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : []
        const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []

        // Start with projectIds, but filter out archived and community projects
        // since they may be included in the base projectIds array
        let targetProjectIds = projectIds.filter(
            id => !archivedProjectIds.includes(id) && !templateProjectIds.includes(id) && !guideProjectIds.includes(id)
        )

        // Now explicitly add back the ones requested via flags
        if (includeArchived) {
            targetProjectIds.push(...archivedProjectIds)
        }
        if (includeCommunity) {
            targetProjectIds.push(...templateProjectIds)
            targetProjectIds.push(...guideProjectIds)
        }

        const uniqueProjectIds = [...new Set(targetProjectIds)]

        if (uniqueProjectIds.length === 0) {
            return []
        }

        // Fetch projects
        const projectDocs = await Promise.all(uniqueProjectIds.map(id => db.collection('projects').doc(id).get()))

        const projects = []
        for (const doc of projectDocs) {
            if (!doc.exists) continue
            const data = doc.data()

            // Determine project type from user lists
            let projectType = 'regular'
            if (archivedProjectIds.includes(doc.id)) {
                projectType = 'archived'
            } else if (templateProjectIds.includes(doc.id)) {
                projectType = 'template'
            } else if (guideProjectIds.includes(doc.id)) {
                projectType = 'guide'
            }

            // Active filter: only exclude when explicitly marked inactive
            const isActive = typeof data.active === 'boolean' ? data.active === true : true
            if (activeOnly && !isActive) {
                continue
            }

            projects.push({
                id: doc.id,
                name: data.name,
                description: data.description || '',
                createdAt: data.createdAt,
                userIds: data.userIds || [],
                projectType,
                active: typeof data.active === 'boolean' ? data.active : undefined,
            })
        }

        return projects
    }
}

module.exports = { ProjectService }
