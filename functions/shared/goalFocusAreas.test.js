const {
    normalizeFocusAreaName,
    getGoalFocusArea,
    groupGoalsByFocusArea,
    ensureProjectFocusArea,
    renameProjectFocusArea,
    resolveFocusAreaForProjectMove,
} = require('./goalFocusAreas')

function database(projects) {
    // Serialize transactions like the retry/commit contract of Firestore.
    let tail = Promise.resolve()
    const writes = []
    const db = {
        doc: path => ({ path }),
        runTransaction: fn => {
            const pending = tail.then(() =>
                fn({
                    get: async ref => ({ exists: !!projects[ref.path], data: () => projects[ref.path] }),
                    update: (ref, changes) => {
                        writes.push({ path: ref.path, changes })
                        Object.entries(changes).forEach(([key, value]) => {
                            const parts = key.split('.')
                            let target = projects[ref.path]
                            parts.slice(0, -1).forEach(part => {
                                target = target[part] ||= {}
                            })
                            target[parts[parts.length - 1]] = value
                        })
                    },
                })
            )
            tail = pending.catch(() => {})
            return pending
        },
    }
    return { db, writes }
}

describe('project focus areas', () => {
    test('normalizes free text without changing its display capitalization', () => {
        expect(normalizeFocusAreaName('  Product\n  Marketing  ')).toBe('Product Marketing')
        expect(normalizeFocusAreaName('Ｍarketing')).toBe('Marketing')
    })

    test('concurrent case and whitespace variants reuse one project identity', async () => {
        const projects = { 'projects/p': {}, 'projects/other': {} }
        const { db, writes } = database(projects)
        const [first, second] = await Promise.all([
            ensureProjectFocusArea(db, 'p', ' Marketing ', 'first'),
            ensureProjectFocusArea(db, 'p', 'marketing', 'second'),
        ])
        expect(first).toEqual({ id: 'first', name: 'Marketing' })
        expect(second).toEqual(first)
        expect(writes).toHaveLength(1)
        expect(await ensureProjectFocusArea(db, 'other', 'Marketing', 'third')).toEqual({
            id: 'third',
            name: 'Marketing',
        })
    })

    test.each(['', ' general ', 'x'.repeat(61)])('rejects an invalid or reserved name: %s', async name => {
        const { db, writes } = database({ 'projects/p': {} })
        await expect(ensureProjectFocusArea(db, 'p', name, 'new')).rejects.toThrow()
        expect(writes).toHaveLength(0)
    })

    test('renaming updates every linked goal through the stable ID and rejects duplicates', async () => {
        const projects = { 'projects/p': { focusAreas: { m: { name: 'Marketing' }, p: { name: 'Product' } } } }
        const { db } = database(projects)
        await renameProjectFocusArea(db, 'p', 'm', 'Growth')
        const catalog = projects['projects/p'].focusAreas
        expect(getGoalFocusArea({ id: 'one', focusAreaId: 'm' }, catalog)).toEqual({ id: 'm', name: 'Growth' })
        expect(getGoalFocusArea({ id: 'two', focusAreaId: 'm' }, catalog)).toEqual({ id: 'm', name: 'Growth' })
        await expect(renameProjectFocusArea(db, 'p', 'm', ' product ')).rejects.toMatchObject({
            code: 'focus-area-duplicate-name',
        })
        expect(catalog.m.name).toBe('Growth')
    })

    test('groups alphabetically, keeps goal order, omits empty areas, and places legacy goals last', () => {
        const goals = [
            { id: '1', focusAreaId: 'p' },
            { id: '2' },
            { id: '3', focusAreaId: 'm' },
            { id: '4', focusAreaId: 'p' },
            { id: '5', focusAreaId: 'missing' },
        ]
        const groups = groupGoalsByFocusArea(goals, {
            p: { name: 'Product' },
            m: { name: 'Marketing' },
            empty: { name: 'Unused' },
        })
        expect(groups.map(group => [group.name, group.goals.map(goal => goal.id)])).toEqual([
            ['Marketing', ['3']],
            ['Product', ['1', '4']],
            ['General', ['2', '5']],
        ])
        expect(goals.map(goal => goal.id)).toEqual(['1', '2', '3', '4', '5'])
    })

    test('moving a goal resolves names in the destination instead of carrying a project-local ID', async () => {
        const source = { focusAreas: { source: { name: 'Marketing' } } }
        const { db, writes } = database({
            'projects/target': { focusAreas: { target: { name: 'marketing' } } },
            'projects/empty': {},
        })
        expect(await resolveFocusAreaForProjectMove(db, source, 'target', { focusAreaId: 'source' }, 'unused')).toBe(
            'target'
        )
        expect(writes).toHaveLength(0)
        expect(await resolveFocusAreaForProjectMove(db, source, 'empty', { focusAreaId: 'source' }, 'new')).toBe('new')
        expect(await resolveFocusAreaForProjectMove(db, source, 'empty', {}, 'unused')).toBeNull()
    })
})
