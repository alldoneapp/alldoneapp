import { getProjectIdsForAllProjectsTasks } from './openTasksViewProjectScope'

const buildProject = (id, name, sortIndex = 0) => ({
    id,
    name,
    sortIndexByUser: { 'logged-user': sortIndex },
})

const loggedUserProjectsMap = {
    'active-project': buildProject('active-project', 'Bravo'),
    'another-active-project': buildProject('another-active-project', 'alpha'),
    'archived-project': buildProject('archived-project', 'Archived'),
    'template-project': buildProject('template-project', 'Template'),
    'guide-project': buildProject('guide-project', 'Guide'),
}

const baseScope = {
    projectIds: ['active-project', 'another-active-project', 'archived-project', 'template-project', 'guide-project'],
    guideProjectIds: ['guide-project'],
    archivedProjectIds: ['archived-project'],
    templateProjectIds: ['template-project'],
    loggedUserProjectsMap,
    loggedUserId: 'logged-user',
    inFocusTaskProjectId: null,
}

describe('getProjectIdsForAllProjectsTasks', () => {
    // AT-2337 / AT-2335: "All projects" means ACTIVE projects, the same canonical scope
    // the Contacts view adopted (`getProjectsForContactsView` → `getActiveProjects2`).
    it('uses the canonical active-project scope for All Projects', () => {
        expect(getProjectIdsForAllProjectsTasks(baseScope).sort()).toEqual(
            ['active-project', 'another-active-project'].sort()
        )
    })

    it('drops guide projects instead of appending them at the end', () => {
        expect(getProjectIdsForAllProjectsTasks(baseScope)).not.toContain('guide-project')
    })

    it('drops archived and template projects', () => {
        const result = getProjectIdsForAllProjectsTasks(baseScope)

        expect(result).not.toContain('archived-project')
        expect(result).not.toContain('template-project')
    })

    it('ignores projects that are not loaded into the projects map yet', () => {
        const result = getProjectIdsForAllProjectsTasks({
            ...baseScope,
            projectIds: [...baseScope.projectIds, 'not-loaded-project'],
        })

        expect(result).not.toContain('not-loaded-project')
    })

    it('sorts by sort index first and then by lowercased name', () => {
        const result = getProjectIdsForAllProjectsTasks({
            ...baseScope,
            loggedUserProjectsMap: {
                ...loggedUserProjectsMap,
                'active-project': buildProject('active-project', 'Bravo', 1),
            },
        })

        expect(result).toEqual(['active-project', 'another-active-project'])
        // Same sort index -> case-insensitive name order ("alpha" before "Bravo").
        expect(getProjectIdsForAllProjectsTasks(baseScope)).toEqual(['another-active-project', 'active-project'])
    })

    it('keeps the in-focus project at the top, listed exactly once', () => {
        const result = getProjectIdsForAllProjectsTasks({ ...baseScope, inFocusTaskProjectId: 'active-project' })

        expect(result[0]).toBe('active-project')
        expect(result.filter(projectId => projectId === 'active-project')).toHaveLength(1)
    })

    // The in-focus project is an explicit per-user pin: focusing a task must never make
    // its project vanish from the board, even when the project is outside the active scope.
    it('keeps an out-of-scope in-focus project on the board', () => {
        expect(getProjectIdsForAllProjectsTasks({ ...baseScope, inFocusTaskProjectId: 'guide-project' })).toEqual([
            'guide-project',
            'another-active-project',
            'active-project',
        ])
    })
})
