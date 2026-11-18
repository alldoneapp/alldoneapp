const {
    compareProjectsInListOrder,
    sortProjectsInListOrder,
    orderProjectIdsForFocusSearch,
} = require('./projectListOrder')

// AT-3085: one project-list order for the sidebar and both focus-task pickers.
describe('projectListOrder', () => {
    const userId = 'u1'
    const project = (id, sortIndex, name = id) => ({ id, name, sortIndexByUser: { [userId]: sortIndex } })

    test('sorts by the user’s own sort index, highest first, then by name', () => {
        const projects = [project('privat', 1), project('jtl', 30), project('b', 20, 'beta'), project('a', 20, 'Alpha')]
        expect(sortProjectsInListOrder(projects, userId).map(p => p.id)).toEqual(['jtl', 'a', 'b', 'privat'])
        // Another user's index does not count.
        const foreign = [{ id: 'x', name: 'x', sortIndexByUser: { other: 99 } }, project('y', 5)]
        expect(sortProjectsInListOrder(foreign, userId).map(p => p.id)).toEqual(['x', 'y'])
    })

    test('puts a project without a sort index at the top, as the sidebar always has', () => {
        const projects = [project('a', 10), { id: 'new', name: 'New' }, project('b', 20)]
        expect(sortProjectsInListOrder(projects, userId).map(p => p.id)).toEqual(['new', 'b', 'a'])
    })

    test('does not mutate its input and tolerates missing names', () => {
        const projects = [project('a', 1), { id: 'b', sortIndexByUser: { [userId]: 2 } }]
        const copy = [...projects]
        expect(sortProjectsInListOrder(projects, userId).map(p => p.id)).toEqual(['b', 'a'])
        expect(projects).toEqual(copy)
        expect(compareProjectsInListOrder(project('a', 1), project('a', 1), userId)).toBe(0)
    })

    test('walks the listed projects from the top, then the other projects', () => {
        const listed = [project('privat', 1), project('jtl', 30), project('growth', 20)]
        const others = [project('guide', 90), project('old', 99)]
        expect(orderProjectIdsForFocusSearch({ listedProjects: listed, otherProjects: others, userId })).toEqual([
            'jtl',
            'growth',
            'privat',
            'old',
            'guide',
        ])
    })

    test('searches the start project first when it is one of the user’s projects', () => {
        const listed = [project('privat', 1), project('jtl', 30), project('growth', 20)]
        expect(orderProjectIdsForFocusSearch({ listedProjects: listed, userId, startProjectId: 'privat' })).toEqual([
            'privat',
            'jtl',
            'growth',
        ])
        // A foreign start project is ignored.
        expect(orderProjectIdsForFocusSearch({ listedProjects: listed, userId, startProjectId: 'foreign' })).toEqual([
            'jtl',
            'growth',
            'privat',
        ])
    })
})
