import {
    splitChipsForDisplay,
    isEmailLineHiddenToday,
    getEmailLineTodayKey,
    getLabelWebUrl,
    MAX_VISIBLE_CHIPS,
} from './emailLineHelper'

describe('emailLineHelper', () => {
    test('splitChipsForDisplay returns all when under the cap', () => {
        const labels = [{ labelId: 'a' }, { labelId: 'b' }]
        expect(splitChipsForDisplay(labels)).toEqual({ visible: labels, overflowCount: 0 })
    })

    test('splitChipsForDisplay splits overflow past the cap', () => {
        const labels = Array.from({ length: MAX_VISIBLE_CHIPS + 3 }, (_, i) => ({ labelId: `l${i}` }))
        const { visible, overflowCount } = splitChipsForDisplay(labels)
        expect(visible).toHaveLength(MAX_VISIBLE_CHIPS)
        expect(overflowCount).toBe(3)
    })

    test('splitChipsForDisplay showAll returns everything', () => {
        const labels = Array.from({ length: MAX_VISIBLE_CHIPS + 3 }, (_, i) => ({ labelId: `l${i}` }))
        const { visible, overflowCount } = splitChipsForDisplay(labels, true)
        expect(visible).toHaveLength(MAX_VISIBLE_CHIPS + 3)
        expect(overflowCount).toBe(0)
    })

    test('isEmailLineHiddenToday matches only the current day key', () => {
        const loggedUser = { timezone: 0 }
        const todayKey = getEmailLineTodayKey(loggedUser)
        expect(isEmailLineHiddenToday({ ...loggedUser, emailLineHiddenTodayByProject: { p1: todayKey } }, 'p1')).toBe(
            true
        )
        expect(
            isEmailLineHiddenToday({ ...loggedUser, emailLineHiddenTodayByProject: { p1: '1999-01-01' } }, 'p1')
        ).toBe(false)
        expect(isEmailLineHiddenToday(loggedUser, 'p1')).toBe(false)
        expect(isEmailLineHiddenToday(loggedUser, undefined)).toBe(false)
    })

    test('getLabelWebUrl builds a Gmail account-chooser deep link for a user label', () => {
        const url = getLabelWebUrl('google', 'me@gmail.com', { labelId: 'Label_1', name: 'Alldone/Ads', kind: 'user' })
        expect(url).toContain('accounts.google.com/AccountChooser')
        expect(url).toContain(encodeURIComponent('me@gmail.com'))
    })

    test('getLabelWebUrl returns the Outlook webmail for Microsoft', () => {
        const url = getLabelWebUrl('microsoft', 'me@outlook.com', { labelId: 'f1', kind: 'folder' })
        expect(url).toBe('https://outlook.office.com/mail/')
    })
})
