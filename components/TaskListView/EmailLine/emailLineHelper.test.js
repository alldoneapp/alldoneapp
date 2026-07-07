import {
    splitChipsForDisplay,
    areEmailLineConnectionsHiddenToday,
    getEmailAccountWebUrl,
    EMAIL_LINE_NO_LABEL_ID,
    getEmailLineTodayKey,
    getLabelDisplayCount,
    getLabelWebUrl,
    mergeLabelsAcrossConnections,
    MAX_VISIBLE_CHIPS,
    markEmailLabelPickerInteraction,
    shouldIgnoreEmailLabelModalDismiss,
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

    test('areEmailLineConnectionsHiddenToday requires every connection to carry the current day key', () => {
        const loggedUser = { timezone: 0 }
        const todayKey = getEmailLineTodayKey(loggedUser)
        expect(
            areEmailLineConnectionsHiddenToday(
                { ...loggedUser, emailLineHiddenTodayByConnection: { c1: todayKey, c2: todayKey } },
                ['c1', 'c2']
            )
        ).toBe(true)
        expect(
            areEmailLineConnectionsHiddenToday(
                { ...loggedUser, emailLineHiddenTodayByConnection: { c1: todayKey, c2: '1999-01-01' } },
                ['c1', 'c2']
            )
        ).toBe(false)
        expect(areEmailLineConnectionsHiddenToday(loggedUser, [])).toBe(false)
    })

    test('getLabelDisplayCount prefers threadCount and falls back to unreadCount', () => {
        expect(getLabelDisplayCount({ threadCount: 4, unreadCount: 9 })).toBe(4)
        expect(getLabelDisplayCount({ threadCount: 0, unreadCount: 9 })).toBe(0)
        expect(getLabelDisplayCount({ unreadCount: 9 })).toBe(9)
        expect(getLabelDisplayCount({})).toBe(0)
    })

    test('mergeLabelsAcrossConnections merges same-named labels and makes Inbox the label total', () => {
        const connections = [
            { connectionId: 'c1', provider: 'google', email: 'a@gmail.com' },
            { connectionId: 'c2', provider: 'microsoft', email: 'b@outlook.com' },
        ]
        const summariesByKey = {
            c1: {
                emailAddress: 'a@gmail.com',
                labels: [
                    { labelId: 'INBOX', displayName: 'Inbox', threadCount: 3, unreadCount: 1, kind: 'inbox' },
                    { labelId: 'Label_ads', displayName: 'Ads', threadCount: 2, unreadCount: 2, kind: 'user' },
                    {
                        labelId: EMAIL_LINE_NO_LABEL_ID,
                        displayName: 'No label',
                        threadCount: 4,
                        unreadCount: 1,
                        kind: 'no_label',
                    },
                ],
            },
            c2: {
                emailAddress: 'b@outlook.com',
                labels: [
                    { labelId: 'f_inbox', displayName: 'Inbox', threadCount: 4, unreadCount: 0, kind: 'inbox' },
                    { labelId: 'f_clients', displayName: 'Clients', threadCount: 5, unreadCount: 1, kind: 'folder' },
                ],
            },
        }
        const groups = mergeLabelsAcrossConnections(connections, summariesByKey)
        expect(groups).toHaveLength(4)
        expect(groups[0].displayName).toBe('Inbox')
        expect(groups[0].isInbox).toBe(true)
        expect(groups[0].threadCount).toBe(11)
        expect(groups[0].unreadCount).toBe(4)
        expect(groups[0].entries.map(entry => entry.labelId)).toEqual([
            'Label_ads',
            EMAIL_LINE_NO_LABEL_ID,
            'f_clients',
        ])
        expect(groups[1].displayName).toBe('Ads')
        expect(groups[1].entries).toHaveLength(1)
        expect(groups[2].displayName).toBe('Clients')
        expect(groups[3].displayName).toBe('No label')
    })

    test('mergeLabelsAcrossConnections skips auth-expired accounts and flags sweeping groups', () => {
        const connections = [
            { connectionId: 'c1', provider: 'google', email: 'a@gmail.com' },
            { connectionId: 'c2', provider: 'google', email: 'b@gmail.com', authInvalid: true },
        ]
        const summariesByKey = {
            c1: {
                emailAddress: 'a@gmail.com',
                labels: [
                    {
                        labelId: 'Label_x',
                        displayName: 'X',
                        threadCount: 0,
                        unreadCount: 0,
                        sweeping: true,
                        kind: 'user',
                    },
                ],
            },
            c2: {
                emailAddress: 'b@gmail.com',
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', threadCount: 9, unreadCount: 9, kind: 'inbox' }],
            },
        }
        const groups = mergeLabelsAcrossConnections(connections, summariesByKey)
        expect(groups).toHaveLength(1)
        expect(groups[0].displayName).toBe('X')
        expect(groups[0].sweeping).toBe(true)
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

    test('getLabelWebUrl builds a Gmail no-label search deep link', () => {
        const url = getLabelWebUrl('google', 'me@gmail.com', {
            labelId: EMAIL_LINE_NO_LABEL_ID,
            displayName: 'No label',
            kind: 'no_label',
        })
        expect(url).toContain('accounts.google.com/AccountChooser')
        expect(decodeURIComponent(decodeURIComponent(url))).toContain('in:inbox has:nouserlabels')
    })

    test('getEmailAccountWebUrl opens Gmail through the selected account', () => {
        const url = getEmailAccountWebUrl('google', 'me@gmail.com')
        expect(url).toContain('accounts.google.com/AccountChooser')
        expect(url).toContain(encodeURIComponent('me@gmail.com'))
        expect(url).not.toContain('#search')
    })

    test('getEmailAccountWebUrl returns the Outlook account entry point for Microsoft', () => {
        expect(getEmailAccountWebUrl('microsoft', 'me@outlook.com')).toBe('https://outlook.office.com/mail/')
    })

    describe('email label picker dismissal guard', () => {
        let now
        beforeEach(() => {
            now = 1_000_000
            jest.spyOn(Date, 'now').mockImplementation(() => now)
            // Drain any stamp left by a previous test.
            shouldIgnoreEmailLabelModalDismiss()
        })
        afterEach(() => Date.now.mockRestore())

        test('does not ignore a dismiss with no recent pick', () => {
            expect(shouldIgnoreEmailLabelModalDismiss()).toBe(false)
        })

        test('swallows exactly one dismiss after a pick, then lets the next through', () => {
            markEmailLabelPickerInteraction()
            now += 250 // the trailing synthesized click lands shortly after the tap
            expect(shouldIgnoreEmailLabelModalDismiss()).toBe(true)
            // Consumed: a genuine outside tap right after is honored.
            expect(shouldIgnoreEmailLabelModalDismiss()).toBe(false)
        })

        test('does not swallow a dismiss long after the pick (stale stamp)', () => {
            markEmailLabelPickerInteraction()
            now += 5000 // no dismiss arrived promptly (e.g. desktop swallowed the click)
            expect(shouldIgnoreEmailLabelModalDismiss()).toBe(false)
        })
    })
})
