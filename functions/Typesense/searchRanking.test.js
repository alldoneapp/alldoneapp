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
})
