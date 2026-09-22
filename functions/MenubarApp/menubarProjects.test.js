const { __private__ } = require('./menubarApp')

const { sortMenubarProjects } = __private__

describe('menubar project ordering', () => {
    test('matches the alldone.app sidebar order for the signed-in user', () => {
        const projects = [
            { id: 'missing', name: 'A missing index', sortIndexByUser: {} },
            { id: 'low', name: 'Zulu', sortIndexByUser: { 'user-1': 10 } },
            { id: 'tie-b', name: 'Beta', sortIndexByUser: { 'user-1': 50 } },
            { id: 'tie-a', name: 'alpha', sortIndexByUser: { 'user-1': 50 } },
            { id: 'other-user', name: 'Other user only', sortIndexByUser: { 'user-2': 100 } },
        ]

        expect(sortMenubarProjects(projects, 'user-1').map(project => project.id)).toEqual([
            'missing',
            'other-user',
            'tie-a',
            'tie-b',
            'low',
        ])
    })

    test('does not mutate the project service result', () => {
        const projects = [
            { id: 'low', name: 'Low', sortIndexByUser: { user: 1 } },
            { id: 'high', name: 'High', sortIndexByUser: { user: 2 } },
        ]

        sortMenubarProjects(projects, 'user')

        expect(projects.map(project => project.id)).toEqual(['low', 'high'])
    })
})
