const mockGetDefaultAssistantIdForProject = jest.fn()
const mockGetAssistantForChat = jest.fn()
const mockGetFeedUserData = jest.fn()

jest.mock('../shared/projectRoutingCommentHelper', () => ({
    getDefaultAssistantIdForProject: (...args) => mockGetDefaultAssistantIdForProject(...args),
}))
jest.mock('../Assistant/assistantHelper', () => ({
    getAssistantForChat: (...args) => mockGetAssistantForChat(...args),
}))
jest.mock('../shared/UserHelper', () => ({
    UserHelper: { getFeedUserData: (...args) => mockGetFeedUserData(...args) },
}))

const {
    buildDescriptionInputsFingerprint,
    buildDescriptionWikiMaterial,
    getProjectDescriptionUpdateSkipReason,
    isDescriptionUpdateInputUnchanged,
    resolveDescriptionFeedUser,
    validateProposedDescription,
} = require('./projectDescriptionRefresh')
const {
    getProjectDescriptionUpdateNextDueAt,
    isProjectDescriptionUpdateDue,
    resolveProjectDescriptionUpdateSettings,
} = require('./knowledgeBaseModel')

const DAY = 24 * 60 * 60 * 1000

describe('settings and schedule', () => {
    it('defaults to on and weekly, and ignores an interval that is not offered', () => {
        expect(resolveProjectDescriptionUpdateSettings({})).toEqual({ enabled: true, intervalDays: 7 })
        expect(resolveProjectDescriptionUpdateSettings({ descriptionUpdate: { intervalDays: 3 } })).toEqual({
            enabled: true,
            intervalDays: 7,
        })
        expect(
            resolveProjectDescriptionUpdateSettings({ descriptionUpdate: { enabled: false, intervalDays: 28 } })
        ).toEqual({ enabled: false, intervalDays: 28 })
        expect(resolveProjectDescriptionUpdateSettings({ descriptionUpdate: { intervalDays: 1 } })).toEqual({
            enabled: true,
            intervalDays: 1,
        })
    })

    it('makes daily due 18 hours after the last decision, so every nightly run qualifies', () => {
        const daily = lastRunAt => ({ descriptionUpdate: { intervalDays: 1 }, descriptionUpdateState: { lastRunAt } })
        expect(getProjectDescriptionUpdateNextDueAt(daily(0))).toBe(18 * 60 * 60 * 1000)
        // Last night's run at 03:10, tonight's at 02:55 (or 02:55 after a DST change): due.
        expect(isProjectDescriptionUpdateDue(daily(0), DAY - 15 * 60 * 1000)).toBe(true)
        expect(isProjectDescriptionUpdateDue(daily(0), 23 * 60 * 60 * 1000)).toBe(true)
        // "Update now" in the afternoon after a nightly decision: not again the same day.
        expect(isProjectDescriptionUpdateDue(daily(0), 11 * 60 * 60 * 1000)).toBe(false)
    })

    it('fingerprints what the model would see, and lets only daily skip on an equal one', () => {
        const material = buildDescriptionWikiMaterial([{ slug: 'team', title: 'Team', body: 'Karsten leitet.' }])
        const base = { systemPrompt: 'rules', currentDescription: 'Profil.', material }
        const fingerprint = buildDescriptionInputsFingerprint(base)

        expect(buildDescriptionInputsFingerprint({ ...base, currentDescription: '  Profil.\n' })).toBe(fingerprint)
        expect(buildDescriptionInputsFingerprint({ ...base, currentDescription: 'Profil neu.' })).not.toBe(fingerprint)
        expect(buildDescriptionInputsFingerprint({ ...base, systemPrompt: 'other rules' })).not.toBe(fingerprint)
        expect(
            buildDescriptionInputsFingerprint({
                ...base,
                material: buildDescriptionWikiMaterial([{ slug: 'team', title: 'Team', body: 'Daniela leitet.' }]),
            })
        ).not.toBe(fingerprint)

        const state = { descriptionUpdateState: { inputsFingerprint: fingerprint } }
        expect(
            isDescriptionUpdateInputUnchanged({ ...state, descriptionUpdate: { intervalDays: 1 } }, fingerprint)
        ).toBe(true)
        expect(isDescriptionUpdateInputUnchanged({ ...state, descriptionUpdate: { intervalDays: 1 } }, 'other')).toBe(
            false
        )
        // Weekly and longer run whenever they are due, as before.
        expect(isDescriptionUpdateInputUnchanged(state, fingerprint)).toBe(false)
        expect(
            isDescriptionUpdateInputUnchanged({ ...state, descriptionUpdate: { intervalDays: 14 } }, fingerprint)
        ).toBe(false)
        // Nothing stored yet (or a conflict cleared it): run.
        expect(
            isDescriptionUpdateInputUnchanged(
                { descriptionUpdate: { intervalDays: 1 }, descriptionUpdateState: { inputsFingerprint: null } },
                fingerprint
            )
        ).toBe(false)
    })

    it('is due at once when it never ran, never when switched off', () => {
        expect(getProjectDescriptionUpdateNextDueAt({})).toBe(0)
        expect(getProjectDescriptionUpdateNextDueAt({ descriptionUpdate: { enabled: false } })).toBeNull()
        expect(getProjectDescriptionUpdateNextDueAt({ descriptionUpdateState: { lastRunAt: 0 } })).toBe(
            7 * DAY - 6 * 60 * 60 * 1000
        )
    })

    it('names why a project is left out', () => {
        expect(getProjectDescriptionUpdateSkipReason({ projectId: 'p', projectData: {}, ownerData: {} })).toBeNull()
        expect(
            getProjectDescriptionUpdateSkipReason({
                projectId: 'p',
                projectData: {},
                ownerData: { archivedProjectIds: ['other'] },
            })
        ).toBeNull()
        expect(
            getProjectDescriptionUpdateSkipReason({
                projectId: 'p',
                projectData: {},
                ownerData: { archivedProjectIds: ['p'] },
            })
        ).toBe('project_archived')
    })
})

describe('buildDescriptionWikiMaterial', () => {
    it('lists every visible page and fills the budget with the most recently updated ones', () => {
        const pages = new Map(
            ['alt', 'neu', 'mitte', 'versteckt'].map((slug, index) => [
                slug,
                {
                    slug,
                    title: slug,
                    body: `${slug} `.repeat(50),
                    updatedAt: { alt: 1, mitte: 2, neu: 3, versteckt: 4 }[slug],
                    needsRebuild: slug === 'versteckt',
                },
            ])
        )

        const material = buildDescriptionWikiMaterial(pages, { maxChars: 700 })

        expect(material.pageCount).toBe(3)
        expect(material.index).not.toContain('versteckt')
        expect(material.sections[0]).toMatch(/^## neu/)
        expect(material.sections.length).toBeLessThan(3)
        expect(material.omitted).toBe(3 - material.sections.length)
    })
})

describe('validateProposedDescription', () => {
    it('lets a short description grow into a profile and a long one keep its length', () => {
        expect(validateProposedDescription('a'.repeat(1900), 'kurz')).toBeNull()
        expect(validateProposedDescription('a'.repeat(2100), 'kurz')).toContain('must stay under 2000')
        expect(validateProposedDescription('a'.repeat(2900), 'b'.repeat(2700))).toBeNull()
        expect(validateProposedDescription('a'.repeat(4100), 'b'.repeat(3900))).toContain('must stay under 4000')
    })
})

describe('resolveDescriptionFeedUser', () => {
    beforeEach(() => jest.clearAllMocks())

    it("credits the project's assistant", async () => {
        mockGetDefaultAssistantIdForProject.mockResolvedValue('anna')
        mockGetAssistantForChat.mockResolvedValue({ uid: 'anna', displayName: 'Anna', photoURL50: 'p.png' })

        const feedUser = await resolveDescriptionFeedUser({ db: {}, projectId: 'p', ownerUserId: 'owner' })

        expect(feedUser).toMatchObject({ uid: 'anna', id: 'anna', creatorId: 'anna', name: 'Anna', photoURL: 'p.png' })
        expect(mockGetFeedUserData).not.toHaveBeenCalled()
    })

    it('falls back to the payer without an assistant, or when looking it up fails', async () => {
        mockGetFeedUserData.mockResolvedValue({ uid: 'owner' })
        mockGetDefaultAssistantIdForProject.mockResolvedValueOnce(null)
        mockGetDefaultAssistantIdForProject.mockRejectedValueOnce(new Error('boom'))
        jest.spyOn(console, 'warn').mockImplementation(() => {})

        expect(await resolveDescriptionFeedUser({ db: {}, projectId: 'p', ownerUserId: 'owner' })).toEqual({
            uid: 'owner',
        })
        expect(await resolveDescriptionFeedUser({ db: {}, projectId: 'p', ownerUserId: 'owner' })).toEqual({
            uid: 'owner',
        })
    })
})
