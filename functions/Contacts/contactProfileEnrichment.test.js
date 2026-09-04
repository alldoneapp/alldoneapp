const mockDeductGold = jest.fn()
const mockRefundGold = jest.fn(async () => ({ success: true }))
const mockGetAssistantForChat = jest.fn()
const mockPostUserRequestComment = jest.fn(async ({ commentId }) => commentId)
const mockGetDefaultAssistantIdForProject = jest.fn(async () => null)
const mockEnsureChatExists = jest.fn(async () => {})
const mockGeneratePreConfigTaskResult = jest.fn(async () => ({ success: true, commentId: 'answer-1' }))
const mockContactSet = jest.fn(async () => {})

let mockDocs = {}
const mockDocRef = path => ({ path, set: mockContactSet })
jest.mock('firebase-admin', () => ({
    firestore: () => ({
        doc: path => mockDocRef(path),
        getAll: async (...refs) =>
            refs.map(ref => {
                const data = mockDocs[ref.path]
                return {
                    id: ref.path.split('/').pop(),
                    exists: !!data,
                    data: () => data,
                    ref,
                }
            }),
    }),
}))
jest.mock('../Gold/goldHelper', () => ({
    deductGold: (...args) => mockDeductGold(...args),
    refundGold: (...args) => mockRefundGold(...args),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))
jest.mock('../Assistant/assistantStatusHelper', () => ({
    ensureChatExists: (...args) => mockEnsureChatExists(...args),
}))
jest.mock('../Assistant/assistantHelper', () => ({
    getAssistantForChat: (...args) => mockGetAssistantForChat(...args),
    postUserRequestComment: (...args) => mockPostUserRequestComment(...args),
}))
jest.mock('../shared/projectRoutingCommentHelper', () => ({
    getDefaultAssistantIdForProject: (...args) => mockGetDefaultAssistantIdForProject(...args),
}))
jest.mock('../Assistant/assistantPreConfigTaskTopic', () => ({
    generatePreConfigTaskResult: (...args) => mockGeneratePreConfigTaskResult(...args),
}))

const {
    CONTACT_ENRICHMENT_GOLD_COST,
    CONTACT_ENRICHMENT_TOOLS,
    buildContactEnrichmentPrompt,
    startContactProfileEnrichment,
} = require('./contactProfileEnrichment')

const ASSISTANT = { uid: 'assistant-1', model: 'MODEL_GPT5_6_SOL', temperature: 'TEMPERATURE_LOW' }

const baseArgs = () => ({
    userId: 'user-1',
    projectId: 'project-1',
    contactId: 'contact-1',
    assistantId: 'assistant-1',
    requestId: 'req-123',
    functionEntryTime: 1000,
})

beforeEach(() => {
    jest.clearAllMocks()
    mockDocs = {
        'projectsContacts/project-1/contacts/contact-1': {
            displayName: 'Anna Somova',
            company: '',
            email: 'anna@example.com',
            isPublicFor: [0, 'user-1'],
        },
        'projects/project-1': { name: 'Sales', assistantId: 'project-assistant' },
        'users/user-1': { language: 'de', defaultAssistantId: 'user-assistant' },
    }
    mockDeductGold.mockResolvedValue({ success: true })
    mockGetAssistantForChat.mockImplementation(async (projectId, assistantId) =>
        assistantId === 'assistant-1' ? ASSISTANT : null
    )
})

describe('startContactProfileEnrichment', () => {
    test('charges the fee, prepares the contact chat and hosts the run inside it', async () => {
        const result = await startContactProfileEnrichment(baseArgs())

        expect(mockDeductGold).toHaveBeenCalledWith('user-1', CONTACT_ENRICHMENT_GOLD_COST, {
            source: 'contact_enrichment',
            projectId: 'project-1',
            objectId: 'contact-1',
            objectType: 'contacts',
            channel: 'contact',
            note: 'Profile research for Anna Somova',
        })
        expect(mockEnsureChatExists).toHaveBeenCalledWith(
            'project-1',
            'contacts',
            'contact-1',
            'assistant-1',
            ['user-1'],
            [0, 'user-1']
        )
        // The follow-up question is answered through the ordinary chat path, which only calls the
        // assistant when the parent object says so.
        expect(mockContactSet).toHaveBeenCalledWith({ isAssistantEnabled: true }, { merge: true })
        expect(mockPostUserRequestComment).toHaveBeenCalledWith({
            projectId: 'project-1',
            objectType: 'contacts',
            objectId: 'contact-1',
            creatorId: 'user-1',
            text: expect.stringMatching(/Enrich the profile of Anna Somova/),
            commentId: 'req-123',
        })

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        const args = mockGeneratePreConfigTaskResult.mock.calls[0]
        expect(args.slice(0, 6)).toEqual(['user-1', 'project-1', 'contact-1', ['user-1'], [0, 'user-1'], 'assistant-1'])
        expect(args[6]).toContain('contactId "contact-1"')
        expect(args[7]).toBe('de')
        expect(args[8]).toEqual({
            model: 'MODEL_GPT5_6_SOL',
            temperature: 'TEMPERATURE_LOW',
            allowedTools: CONTACT_ENRICHMENT_TOOLS,
        })
        // A present-but-undefined key would count as an override of the assistant's saved effort.
        expect(Object.prototype.hasOwnProperty.call(args[8], 'reasoningEffort')).toBe(false)
        expect(args[10]).toBe(1000)
        expect(args[11]).toBe('contacts')
        expect(args[12]).toEqual({
            triggerMessageId: 'req-123',
            disableToolSearch: true,
            // Without this the gate in storeChunks answers "Tool not permitted: fetch_url" for any
            // assistant whose persisted allowedTools predate the research tools (seen in production).
            serverGrantedTools: CONTACT_ENRICHMENT_TOOLS,
        })

        expect(result).toEqual({
            success: true,
            projectId: 'project-1',
            contactId: 'contact-1',
            assistantId: 'assistant-1',
            commentId: 'req-123',
            goldCharged: CONTACT_ENRICHMENT_GOLD_COST,
            resultCommentId: 'answer-1',
        })
        expect(mockRefundGold).not.toHaveBeenCalled()
    })

    test("passes the assistant's saved reasoning effort through when it has one", async () => {
        mockGetAssistantForChat.mockResolvedValue({ ...ASSISTANT, reasoningEffort: 'high' })
        await startContactProfileEnrichment(baseArgs())
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][8].reasoningEffort).toBe('high')
    })

    test('the research run always carries the research tools, whatever the assistant persisted', () => {
        expect(CONTACT_ENRICHMENT_TOOLS).toEqual(
            expect.arrayContaining(['web_search', 'fetch_url', 'find_profile_photo', 'update_contact'])
        )
    })

    test('reports insufficient gold without touching the thread', async () => {
        mockDeductGold.mockResolvedValue({ success: false, message: 'Not enough Gold' })
        const result = await startContactProfileEnrichment(baseArgs())
        expect(result).toEqual({ success: false, error: 'insufficient_gold', message: 'Not enough Gold' })
        expect(mockEnsureChatExists).not.toHaveBeenCalled()
        expect(mockPostUserRequestComment).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
    })

    test('a missing contact costs nothing', async () => {
        delete mockDocs['projectsContacts/project-1/contacts/contact-1']
        const result = await startContactProfileEnrichment(baseArgs())
        expect(result.error).toBe('contact_not_found')
        expect(mockDeductGold).not.toHaveBeenCalled()
    })

    test('falls back from the requested assistant to the contact assistant, then the project default', async () => {
        mockDocs['projectsContacts/project-1/contacts/contact-1'].assistantId = 'contact-assistant'
        mockGetAssistantForChat.mockImplementation(async (projectId, assistantId) =>
            assistantId === 'contact-assistant' ? { ...ASSISTANT, uid: 'contact-assistant' } : null
        )
        const result = await startContactProfileEnrichment({ ...baseArgs(), assistantId: 'gone' })
        expect(result.assistantId).toBe('contact-assistant')

        mockGetAssistantForChat.mockImplementation(async (projectId, assistantId) =>
            assistantId === 'default-1' ? { ...ASSISTANT, uid: 'default-1' } : null
        )
        mockGetDefaultAssistantIdForProject.mockResolvedValue('default-1')
        const viaDefault = await startContactProfileEnrichment({ ...baseArgs(), assistantId: '' })
        expect(viaDefault.assistantId).toBe('default-1')
        expect(mockGetDefaultAssistantIdForProject).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user-1', defaultAssistantId: 'user-assistant' }),
            'project-1'
        )
    })

    test('with no assistant anywhere it refuses before charging', async () => {
        mockGetAssistantForChat.mockResolvedValue(null)
        const result = await startContactProfileEnrichment(baseArgs())
        expect(result.error).toBe('no_assistant')
        expect(mockDeductGold).not.toHaveBeenCalled()
    })

    test('refunds the fee and rethrows when the run fails', async () => {
        mockGeneratePreConfigTaskResult.mockRejectedValueOnce(new Error('model down'))
        await expect(startContactProfileEnrichment(baseArgs())).rejects.toThrow('model down')
        expect(mockRefundGold).toHaveBeenCalledWith(
            'user-1',
            CONTACT_ENRICHMENT_GOLD_COST,
            expect.objectContaining({
                source: 'contact_enrichment',
                objectId: 'contact-1',
                note: expect.stringMatching(/model down/),
            })
        )
    })
})

describe('buildContactEnrichmentPrompt', () => {
    test('names the contact, its current fields and the rules the run must follow', () => {
        const prompt = buildContactEnrichmentPrompt({
            contact: { displayName: 'Anna Somova', company: 'Example GmbH', email: 'anna@example.com' },
            contactId: 'contact-1',
            project: { name: 'Sales' },
            projectId: 'project-1',
        })
        expect(prompt).toContain('Research the contact "Anna Somova"')
        expect(prompt).toContain('project "Sales", contactId "contact-1"')
        expect(prompt).toContain('- Company: Example GmbH')
        expect(prompt).toMatch(/Never try to fetch linkedin\.com pages/)
        expect(prompt).toMatch(/two or more plausible people/)
        expect(prompt).toContain('call update_contact once with contactId "contact-1"')
        expect(prompt).toMatch(/Never overwrite a non-empty field/)
    })
})
