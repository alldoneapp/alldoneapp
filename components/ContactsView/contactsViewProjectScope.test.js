import { getProjectsForContactsView } from './contactsViewProjectScope'

const projects = [
    { id: 'active-project' },
    { id: 'archived-project' },
    { id: 'template-project' },
    { id: 'guide-project' },
    { id: 'inactive-project' },
]
const loggedUser = {
    uid: 'logged-user',
    projectIds: ['active-project', 'archived-project', 'template-project', 'guide-project'],
    archivedProjectIds: ['archived-project'],
    templateProjectIds: ['template-project'],
    guideProjectIds: ['guide-project'],
}

describe('getProjectsForContactsView', () => {
    it('uses the canonical active-project scope for All Projects', () => {
        expect(getProjectsForContactsView(true, projects, loggedUser)).toEqual([{ id: 'active-project' }])
    })

    it('preserves archived and inactive projects when a project is explicitly selected', () => {
        expect(getProjectsForContactsView(false, projects, loggedUser)).toBe(projects)
    })
})
