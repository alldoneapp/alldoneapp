import {
    splitChipsForDisplay,
    areEmailLineConnectionsHiddenToday,
    buildLabelOptionMaps,
    getEmailAccountWebUrl,
    getEmailLabelGroupsForProject,
    getUnassignedEmailLabelGroups,
    EMAIL_LINE_NO_LABEL_ID,
    getEmailLineTodayKey,
    getLabelDisplayCount,
    getLabelWebUrl,
    mergeLabelsAcrossConnections,
    MAX_VISIBLE_CHIPS,
    markEmailLabelPickerInteraction,
    resolveUnsubscribeUrl,
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
        // Inbox borrows the labels' counts but keeps each account's own inbox bucket as its
        // entries, so opening it lists the inbox itself rather than every label in turn.
        expect(groups[0].entries.map(entry => entry.labelId)).toEqual(['INBOX', 'f_inbox'])
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

    test('mergeLabelsAcrossConnections carries the server projectId onto its group', () => {
        const connections = [{ connectionId: 'c1', provider: 'google', email: 'a@gmail.com' }]
        const summariesByKey = {
            c1: {
                emailAddress: 'a@gmail.com',
                labels: [
                    { labelId: 'INBOX', displayName: 'Inbox', threadCount: 5, unreadCount: 1, kind: 'inbox' },
                    {
                        labelId: 'Label_mk',
                        displayName: 'Marketing',
                        threadCount: 3,
                        unreadCount: 1,
                        kind: 'user',
                        projectId: 'proj_marketing',
                    },
                    { labelId: 'Label_ads', displayName: 'Ads', threadCount: 2, unreadCount: 0, kind: 'user' },
                ],
            },
        }
        const groups = mergeLabelsAcrossConnections(connections, summariesByKey)
        const byName = Object.fromEntries(groups.map(group => [group.displayName, group]))
        expect(byName['Marketing'].projectId).toBe('proj_marketing')
        expect(byName['Ads'].projectId).toBe(null)
        expect(byName['Inbox'].projectId).toBe(null)
    })

    describe('header chip partitioning', () => {
        const groups = [
            { key: 'inbox', displayName: 'Inbox', isInbox: true, projectId: null, threadCount: 9, sweeping: false },
            {
                key: 'mk',
                displayName: 'Marketing',
                isInbox: false,
                projectId: 'proj_mk',
                threadCount: 3,
                sweeping: false,
            },
            { key: 'ops', displayName: 'Ops', isInbox: false, projectId: 'proj_ops', threadCount: 0, sweeping: true },
            { key: 'ads', displayName: 'Ads', isInbox: false, projectId: null, threadCount: 2, sweeping: false },
            { key: 'no', displayName: 'No label', isInbox: false, projectId: null, threadCount: 4, sweeping: false },
            {
                key: 'empty',
                displayName: 'Empty',
                isInbox: false,
                projectId: 'proj_mk',
                threadCount: 0,
                sweeping: false,
            },
        ]

        test('getEmailLabelGroupsForProject returns only that project’s chip-worthy labels', () => {
            expect(getEmailLabelGroupsForProject(groups, 'proj_mk').map(g => g.displayName)).toEqual(['Marketing'])
            expect(getEmailLabelGroupsForProject(groups, 'proj_ops').map(g => g.displayName)).toEqual(['Ops'])
            expect(getEmailLabelGroupsForProject(groups, undefined)).toEqual([])
        })

        test('getUnassignedEmailLabelGroups returns Inbox + Ads/No label but never project labels', () => {
            expect(getUnassignedEmailLabelGroups(groups).map(g => g.displayName)).toEqual(['Inbox', 'Ads', 'No label'])
        })
    })

    test('buildLabelOptionMaps normalizes options and flags disabled labeling per connection', () => {
        const connections = [
            { connectionId: 'c1', provider: 'google' },
            { connectionId: 'c2', provider: 'microsoft' },
        ]
        const summariesByKey = {
            c1: {
                labelOptions: ['Ads', { gmailLabelName: 'Marketing', displayName: 'Marketing' }, { displayName: 'x' }],
                labelingEnabled: false,
            },
            c2: { labelOptions: [{ gmailLabelName: 'Clients', displayName: 'Clients' }], labelingEnabled: false },
        }
        const { labelOptionsByConnectionId, labelingDisabledByConnectionId } = buildLabelOptionMaps(
            connections,
            summariesByKey
        )
        expect(labelOptionsByConnectionId.c1).toEqual([
            { gmailLabelName: 'Ads', displayName: 'Ads' },
            { gmailLabelName: 'Marketing', displayName: 'Marketing' },
        ])
        expect(labelingDisabledByConnectionId.c1).toBe(true)
        // Microsoft accounts never report labeling as disabled.
        expect(labelingDisabledByConnectionId.c2).toBe(false)
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

    describe('resolveUnsubscribeUrl', () => {
        test('prefers a whitelisted https unsubscribe link', () => {
            const url = resolveUnsubscribeUrl({
                unsubscribe: { httpsUrl: 'https://ex.com/u', mailto: 'mailto:u@ex.com' },
                webUrl: 'https://mail.google.com/x',
            })
            expect(url).toBe('https://ex.com/u')
        })

        test('falls back to the message url for a mailto-only header', () => {
            const url = resolveUnsubscribeUrl({
                unsubscribe: { mailto: 'mailto:u@ex.com' },
                webUrl: 'https://mail.google.com/x',
            })
            expect(url).toBe('https://mail.google.com/x')
        })

        test('returns null for a mailto-only header without a message url', () => {
            expect(resolveUnsubscribeUrl({ unsubscribe: { mailto: 'mailto:u@ex.com' } })).toBeNull()
        })

        test('ignores a non-https url and rejects missing metadata', () => {
            expect(resolveUnsubscribeUrl({ unsubscribe: { httpsUrl: 'http://ex.com/u' } })).toBeNull()
            expect(resolveUnsubscribeUrl({ unsubscribe: null })).toBeNull()
            expect(resolveUnsubscribeUrl(null)).toBeNull()
        })
    })
})
