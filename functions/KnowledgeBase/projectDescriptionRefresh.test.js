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
    buildDescriptionWikiMaterial,
    getProjectDescriptionUpdateSkipReason,
    resolveDescriptionFeedUser,
    validateProposedDescription,
} = require('./projectDescriptionRefresh')
const {
    getProjectDescriptionUpdateNextDueAt,
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
