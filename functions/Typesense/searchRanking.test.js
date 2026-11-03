const { buildRecencySortBy, RECENCY_SORT } = require('./searchRanking')

describe('AT-2663 search recency ranking', () => {
    it.each([
        ['dev_tasks', 'humanReadableIdSearchable,humanReadableId,name', 'humanReadableId:=`AT-2663`'],
        ['dev_goals', 'name', 'name:=`AT-2663`'],
        ['dev_notes', 'title,content', 'title:=`AT-2663`'],
        ['dev_contacts', 'displayName,cleanDescription,role,company', 'displayName:=`AT-2663`'],
        ['dev_updates', 'cleanName,cleanLastComment,cleanComments', 'cleanName:=`AT-2663`'],
    ])('protects exact identities and boosts last-edited recency in %s', (collection, queryBy, guard) => {
        const sort = buildRecencySortBy(collection, 'AT-2663', queryBy)
        expect(sort).toContain(guard)
        expect(sort).toMatch(/^_eval\(/)
        expect(sort).toContain(RECENCY_SORT)
        expect(sort).not.toContain('created')
        expect(sort).not.toContain('content:=')
        expect(sort).not.toContain('cleanDescription:=')
        expect(sort).not.toContain('cleanComments:=')
    })

    it.each(['', '   ', '*', undefined])('sorts an unranked query %p purely by edits', query => {
        expect(buildRecencySortBy('dev_tasks', query, 'name')).toBe('lastEditionDate(missing_values: last):desc')
    })

    it('only protects fields searched by this particular request', () => {
        expect(buildRecencySortBy('dev_contacts', 'Anna', 'company')).toBe(
            `_eval(company:=\`Anna\`):desc,${RECENCY_SORT}`
        )
        expect(buildRecencySortBy('dev_notes', 'Anna', 'content')).toBe(
            '_text_match:desc,lastEditionDate(missing_values: last):desc'
        )
    })

    it('quotes filter operators and punctuation in user input without widening the guard', () => {
        expect(buildRecencySortBy('dev_notes', ' roadmap, (draft) || title:* ', 'title')).toBe(
            `_eval(title:=\`roadmap, (draft) || title:*\`):desc,${RECENCY_SORT}`
        )
    })

    it('uses strict ranking for input with a filter quote delimiter', () => {
        expect(buildRecencySortBy('dev_notes', 'roadmap` || title:*', 'title')).toBe(
            '_text_match:desc,lastEditionDate(missing_values: last):desc'
        )
    })

    describe("boosting the signed-in user's own objects (AT-2945)", () => {
        const boostCreator = { attribute: 'userId', userId: 'me' }

        it('keeps exact identity matches first and ranks own matches ahead of the rest', () => {
            expect(buildRecencySortBy('dev_notes', 'Roadmap', 'title,content', { boostCreator })).toBe(
                '_eval([((title:=`Roadmap`) && userId:=`me`):3,(title:=`Roadmap`):2,(userId:=`me`):1]):desc,' +
                    RECENCY_SORT
            )
        })

        it('groups several exact identity fields before combining them with the creator', () => {
            const sort = buildRecencySortBy('dev_tasks', 'AT-1', 'humanReadableIdSearchable,humanReadableId,name', {
                boostCreator,
            })
            expect(sort).toContain(
                '((humanReadableIdSearchable:=`AT-1` || humanReadableId:=`AT-1` || name:=`AT-1`) && userId:=`me`):3'
            )
        })

        it('stays within the three sort fields Typesense allows', () => {
            const sort = buildRecencySortBy('dev_notes', 'Roadmap', 'title,content', { boostCreator })
            // Commas inside `_eval([...])` and `_text_match(...)` are not field separators.
            let depth = 0
            let fields = 1
            for (const char of sort) {
                if (char === '(' || char === '[') depth++
                else if (char === ')' || char === ']') depth--
                else if (char === ',' && depth === 0) fields++
            }
            expect(depth).toBe(0)
            expect(fields).toBe(3)
        })

        it('boosts own objects in strict ranking too, with no exact guard to share the field', () => {
            expect(buildRecencySortBy('dev_notes', 'Anna', 'content', { boostCreator })).toBe(
                '_eval(userId:=`me`):desc,_text_match:desc,lastEditionDate(missing_values: last):desc'
            )
            expect(buildRecencySortBy('dev_notes', 'a`b', 'title', { boostCreator })).toBe(
                '_eval(userId:=`me`):desc,_text_match:desc,lastEditionDate(missing_values: last):desc'
            )
        })

        it('leaves a wildcard page ordered by recency alone', () => {
            expect(buildRecencySortBy('dev_notes', '*', 'title', { boostCreator })).toBe(
                'lastEditionDate(missing_values: last):desc'
            )
        })

        it('degrades to the unboosted sort for anything it cannot express safely', () => {
            const plain = buildRecencySortBy('dev_notes', 'Roadmap', 'title,content')
            ;[
                undefined,
                null,
                {},
                { attribute: 'userId' },
                { attribute: 'userId', userId: '' },
                { attribute: 'userId', userId: '```' },
                { attribute: 'userId || true', userId: 'me' },
                { attribute: '', userId: 'me' },
                { attribute: 'userId', userId: { id: 'me' } },
            ].forEach(option => {
                expect(buildRecencySortBy('dev_notes', 'Roadmap', 'title,content', { boostCreator: option })).toBe(
                    plain
                )
            })
        })

        it('strips a backtick from the user id so it cannot break out of the literal', () => {
            expect(
                buildRecencySortBy('dev_notes', 'Anna', 'content', {
                    boostCreator: { attribute: 'userId', userId: 'm`e' },
                })
            ).toContain('_eval(userId:=`me`)')
        })
    })
})
