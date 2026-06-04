const { getAccessibleProjectIdsFromUserData, getDelegationScopeProjectIdsFromUserData } = require('./projectScope')

describe('delegation target project scope', () => {
    // In this data model `projectIds` is the full set; archived/template/guide are markers within
    // it. p1/p2 are active owned projects, g1 is a guide project, t1 a template, a1 archived.
    const userData = {
        projectIds: ['p1', 'p2', 'g1', 't1', 'a1'],
        guideProjectIds: ['g1'],
        templateProjectIds: ['t1'],
        archivedProjectIds: ['a1'],
    }

    test('accessible project ids include every project (active, guide, template, archived)', () => {
        expect(getAccessibleProjectIdsFromUserData(userData)).toEqual(['p1', 'p2', 'g1', 't1', 'a1'])
    })

    test('delegation scope is active projects only (excludes guide, template, archived)', () => {
        expect(getDelegationScopeProjectIdsFromUserData(userData)).toEqual(['p1', 'p2'])
    })

    test('delegation scope excludes guide projects even when not archived or template', () => {
        expect(
            getDelegationScopeProjectIdsFromUserData({
                projectIds: ['p1', 'g1', 'g2'],
                guideProjectIds: ['g1', 'g2'],
            })
        ).toEqual(['p1'])
    })

    test('delegation scope dedupes and ignores blank/invalid ids', () => {
        expect(
            getDelegationScopeProjectIdsFromUserData({
                projectIds: ['p1', 'p1', '  ', 'p2'],
            })
        ).toEqual(['p1', 'p2'])
    })

    test('delegation scope is empty for users with no projects', () => {
        expect(getDelegationScopeProjectIdsFromUserData({})).toEqual([])
        expect(getDelegationScopeProjectIdsFromUserData(undefined)).toEqual([])
    })
})
