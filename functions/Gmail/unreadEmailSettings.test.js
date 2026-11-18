'use strict'

const {
    getUnreadEmailSetting,
    resolveUnreadEmailKind,
    shouldArchiveForUnreadSettings,
} = require('./unreadEmailSettings')

describe('resolveUnreadEmailKind', () => {
    test('the Ads label wins over the classifier kind', () => {
        expect(resolveUnreadEmailKind({ labelKey: 'ads', emailKind: 'newsletter' })).toBe('ads')
    })

    test('a custom newsletter label wins over the classifier kind', () => {
        expect(resolveUnreadEmailKind({ labelKey: 'Newsletter', emailKind: 'ads' })).toBe('newsletter')
    })

    test('a project label leaves the decision to the classifier kind', () => {
        expect(resolveUnreadEmailKind({ labelKey: 'project_abc', emailKind: 'notification' })).toBe('notification')
        expect(resolveUnreadEmailKind({ labelKey: 'project_abc', emailKind: null })).toBeNull()
    })
})

describe('getUnreadEmailSetting', () => {
    test('defaults to show', () => {
        expect(getUnreadEmailSetting({}, 'ads')).toBe('show')
        expect(getUnreadEmailSetting({ unreadEmailSettings: { ads: 'nonsense' } }, 'ads')).toBe('show')
    })

    test('reads archive', () => {
        expect(getUnreadEmailSetting({ unreadEmailSettings: { newsletter: 'archive' } }, 'newsletter')).toBe('archive')
    })
})

describe('shouldArchiveForUnreadSettings', () => {
    const userData = { unreadEmailSettings: { newsletter: 'archive', ads: 'show' } }

    test('archives an informational newsletter when the user chose archive', () => {
        expect(shouldArchiveForUnreadSettings({ userData, emailKind: 'newsletter', direction: 'incoming' })).toBe(true)
    })

    test('keeps ads when the user chose show, and everything by default', () => {
        expect(shouldArchiveForUnreadSettings({ userData, labelKey: 'ads', direction: 'incoming' })).toBe(false)
        expect(shouldArchiveForUnreadSettings({ userData: {}, emailKind: 'newsletter', direction: 'incoming' })).toBe(
            false
        )
    })

    test('never archives other kinds', () => {
        const all = { unreadEmailSettings: { newsletter: 'archive', ads: 'archive' } }
        expect(shouldArchiveForUnreadSettings({ userData: all, emailKind: 'notification' })).toBe(false)
        expect(shouldArchiveForUnreadSettings({ userData: all, emailKind: 'person' })).toBe(false)
        expect(shouldArchiveForUnreadSettings({ userData: all, emailKind: null })).toBe(false)
    })

    test('never archives work, a reply owed, or sent mail', () => {
        const all = { unreadEmailSettings: { newsletter: 'archive', ads: 'archive' } }
        expect(shouldArchiveForUnreadSettings({ userData: all, labelKey: 'ads', followUpType: 'actionable' })).toBe(
            false
        )
        expect(shouldArchiveForUnreadSettings({ userData: all, emailKind: 'newsletter', needsReply: true })).toBe(false)
        expect(shouldArchiveForUnreadSettings({ userData: all, labelKey: 'ads', direction: 'outgoing' })).toBe(false)
    })
})

describe('the merged ads switch (2026-11-18)', () => {
    const { migrateAdsAutoArchiveSetting, resolveAdsUnreadSetting } = require('./unreadEmailSettings')

    test("the user's own choice wins over the connection's old Auto-archive Ads", () => {
        expect(resolveAdsUnreadSetting({ unreadEmailSettings: { ads: 'show' } }, { adsAutoArchive: true })).toBe('show')
        expect(resolveAdsUnreadSetting({ unreadEmailSettings: { ads: 'archive' } }, {})).toBe('archive')
    })

    test('without a choice the connection value counts', () => {
        expect(resolveAdsUnreadSetting({}, { adsAutoArchive: true })).toBe('archive')
        expect(resolveAdsUnreadSetting({}, {})).toBe('show')
    })

    const buildDb = update => ({ collection: () => ({ doc: () => ({ update }) }) })

    test('copies an old Auto-archive Ads onto the user once', async () => {
        const update = jest.fn().mockResolvedValue(undefined)
        const userData = await migrateAdsAutoArchiveSetting({
            db: buildDb(update),
            userId: 'user-1',
            userData: { unreadEmailSettings: { newsletter: 'archive' } },
            config: { adsAutoArchive: true },
        })

        expect(update).toHaveBeenCalledWith({ 'unreadEmailSettings.ads': 'archive' })
        expect(userData.unreadEmailSettings).toEqual({ newsletter: 'archive', ads: 'archive' })
    })

    test('leaves a user who chose, or a connection without it, alone', async () => {
        const update = jest.fn()
        const chose = { unreadEmailSettings: { ads: 'show' } }
        expect(
            await migrateAdsAutoArchiveSetting({
                db: buildDb(update),
                userId: 'u',
                userData: chose,
                config: { adsAutoArchive: true },
            })
        ).toBe(chose)
        await migrateAdsAutoArchiveSetting({ db: buildDb(update), userId: 'u', userData: {}, config: {} })
        expect(update).not.toHaveBeenCalled()
    })

    test('a failed copy still applies the old choice for this run', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        const update = jest.fn().mockRejectedValue(new Error('unavailable'))
        const userData = await migrateAdsAutoArchiveSetting({
            db: buildDb(update),
            userId: 'u',
            userData: {},
            config: { adsAutoArchive: true },
        })
        expect(userData.unreadEmailSettings.ads).toBe('archive')
    })
})
