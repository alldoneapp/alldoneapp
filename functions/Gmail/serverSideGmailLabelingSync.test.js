jest.mock('firebase-admin', () => {
    const getAll = jest.fn()
    const doc = jest.fn(path => ({
        path,
        get: jest.fn(),
        set: jest.fn(),
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: jest.fn(),
                set: jest.fn(),
                collection: jest.fn(() => ({
                    doc: jest.fn(() => ({
                        get: jest.fn(),
                        set: jest.fn(),
                    })),
                })),
            })),
        })),
    }))
    const collection = jest.fn(path => ({
        path,
        doc: jest.fn(() => ({
            get: jest.fn(),
            set: jest.fn(),
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn(),
                    set: jest.fn(),
                })),
            })),
        })),
        limit: jest.fn(() => ({
            get: jest.fn(),
        })),
    }))

    return {
        firestore: Object.assign(
            jest.fn(() => ({
                getAll,
                doc,
                collection,
            })),
            {
                Timestamp: {
                    now: jest.fn(() => 'timestamp-now'),
                },
            }
        ),
        __mock: {
            getAll,
            doc,
            collection,
        },
    }
})

jest.mock('googleapis', () => ({
    google: {
        gmail: jest.fn(),
    },
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: jest.fn(),
    getOAuth2Client: jest.fn(),
}))

jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: jest.fn(() => Promise.resolve()),
    calculateTokens: jest.fn(() => 0),
    calculateGoldCostFromTokens: jest.fn(() => 0),
    collectAssistantTextWithToolCalls: jest.fn(),
    getAssistantForChat: jest.fn(),
    interactWithChatStream: jest.fn(),
    parseTextForUseLiKePrompt: jest.fn(text => text),
}))

jest.mock('../Firestore/assistantsFirestore', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    getDefaultAssistantData: jest.fn(),
}))

jest.mock('../Gold/goldHelper', () => ({
    deductGold: jest.fn(),
    refundGold: jest.fn(),
}))

jest.mock('../Users/usersFirestore', () => ({
    adGoldToUser: jest.fn(),
}))

jest.mock('./gmailPromptClassifier', () => ({
    classifyGmailMessage: jest.fn(),
}))

const admin = require('firebase-admin')
const assistantHelper = require('../Assistant/assistantHelper')
const assistantsFirestore = require('../Firestore/assistantsFirestore')
const { deductGold } = require('../Gold/goldHelper')
const { classifyGmailMessage } = require('./gmailPromptClassifier')
const {
    buildDefaultActiveProjectLabelDefinitions,
    buildDefaultProjectFollowUpPrompt,
    buildGmailMessageUrl,
    buildPostLabelGmailContext,
    createPostLabelPromptHash,
    executePostLabelPrompt,
    getDefaultAssistantIdForProject,
    getExternalRecipientEmails,
    processSingleMessage,
    resolveEffectiveGmailLabelingConfig,
} = require('./serverSideGmailLabelingSync')

function buildDefaultCollectionMock(path) {
    return {
        path,
        doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ data: () => ({ gold: 99 }) }),
            set: jest.fn(),
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn(),
                    set: jest.fn(),
                })),
            })),
        })),
        limit: jest.fn(() => ({
            get: jest.fn(),
        })),
    }
}

describe('serverSideGmailLabelingSync helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        deductGold.mockResolvedValue({ success: true, newBalance: 99 })
        admin.firestore.mockImplementation(() => ({
            getAll: admin.__mock.getAll,
            doc: admin.__mock.doc,
            collection: admin.__mock.collection,
        }))
        admin.__mock.collection.mockImplementation(path => buildDefaultCollectionMock(path))
    })

    test('builds a Gmail message web url', () => {
        expect(buildGmailMessageUrl('person@example.com', 'msg-123')).toBe(
            'https://mail.google.com/mail/u/0/?authuser=person%40example.com#all/msg-123'
        )
    })

    test('hashes follow-up prompt by rule key and prompt', () => {
        const hashA = createPostLabelPromptHash('urgent', 'create a task')
        const hashB = createPostLabelPromptHash('urgent', 'create a task')
        const hashC = createPostLabelPromptHash('urgent', 'create another task')

        expect(hashA).toBe(hashB)
        expect(hashA).not.toBe(hashC)
    })

    test('builds Gmail follow-up tool runtime context', () => {
        expect(
            buildPostLabelGmailContext({
                normalizedMessage: { messageId: 'message-1', threadId: 'thread-1' },
                gmailEmail: 'Person@Example.com',
                assistantProjectId: 'project-1',
            })
        ).toEqual({
            origin: 'gmail_label_follow_up',
            gmailEmail: 'person@example.com',
            projectId: 'project-1',
            messageId: 'message-1',
            threadId: 'thread-1',
            webUrl: 'https://mail.google.com/mail/u/0/?authuser=person%40example.com#all/message-1',
            archiveOnComplete: true,
            direction: 'incoming',
            targetContactEmail: '',
            targetContactName: '',
        })
    })

    test('collects outgoing recipient emails from To only', () => {
        expect(
            getExternalRecipientEmails(
                {
                    to: 'Me@example.com, alice@example.com, alice@example.com, Bob@example.com',
                    cc: 'carol@example.com',
                    bcc: 'dave@example.com',
                },
                'me@example.com'
            )
        ).toEqual(['alice@example.com', 'bob@example.com'])
    })

    test('builds default active project labels with duplicate project names suffixed and follow-ups', () => {
        const labels = buildDefaultActiveProjectLabelDefinitions([
            { id: 'project-a', name: 'Client', description: 'Project Description: Website launch' },
            { id: 'project-b', name: 'Client', description: '' },
        ])

        expect(labels.map(label => label.gmailLabelName)).toEqual(['Client', 'Client (2)'])
        expect(labels[0].description).toContain('Website launch')
        expect(labels[0].description).not.toContain('Project description: Project Description')
        expect(labels[0].directionScope).toBe('both')
        expect(labels[0].autoArchive).toBe(false)
        expect(labels[0].postLabelPrompt).toContain('Only if its an inbound email')
        expect(labels[0].postLabelPrompt).toContain('update_note')
        expect(labels[0].postLabelPromptDirectionScope).toBe('incoming')
    })

    test('builds the default project follow-up prompt with the label name', () => {
        const prompt = buildDefaultProjectFollowUpPrompt('Alldone Product')

        expect(prompt).toContain('project Alldone Product')
        expect(prompt).toContain('hello@cal.com')
        expect(prompt).toContain('with a space at the end')
    })

    test('resolves default mode to active project labels and excludes inactive project types', async () => {
        const projectDataById = {
            active: { exists: true, data: () => ({ name: 'Active Client', description: 'Support retainer' }) },
            archived: { exists: true, data: () => ({ name: 'Archived Client', description: '' }) },
            template: { exists: true, data: () => ({ name: 'Template Client', isTemplate: true }) },
            guide: { exists: true, data: () => ({ name: 'Guide Client', parentTemplateId: 'template-1' }) },
            inactive: { exists: true, data: () => ({ name: 'Inactive Client', active: false }) },
        }
        admin.firestore.mockImplementation(() => ({
            collection: jest.fn(path => {
                if (path === 'projects') {
                    return {
                        doc: jest.fn(projectId => ({
                            get: jest.fn().mockResolvedValue(projectDataById[projectId] || { exists: false }),
                        })),
                    }
                }
                return buildDefaultCollectionMock(path)
            }),
            doc: admin.__mock.doc,
            getAll: admin.__mock.getAll,
        }))

        const config = await resolveEffectiveGmailLabelingConfig(
            {
                enabled: true,
                promptMode: 'default',
                prompt: 'Custom prompt that should not be used',
                labelDefinitions: [
                    {
                        key: 'custom',
                        gmailLabelName: 'Custom',
                        description: 'Custom rule',
                        postLabelPrompt: 'Create a custom follow-up',
                    },
                ],
            },
            {
                projectIds: ['active', 'archived', 'template', 'guide', 'inactive'],
                archivedProjectIds: ['archived'],
                templateProjectIds: ['template'],
                guideProjectIds: ['guide'],
            }
        )

        expect(config.prompt).toContain('active Alldone project')
        expect(config.labelDefinitions).toHaveLength(1)
        expect(config.labelDefinitions[0]).toEqual(
            expect.objectContaining({
                gmailLabelName: 'Active Client',
                autoArchive: false,
                postLabelPrompt: expect.stringContaining('update_note'),
                postLabelPromptDirectionScope: 'incoming',
            })
        )
    })

    test('skips inbound-only default follow-up prompts for outgoing messages', async () => {
        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: {
                key: 'project_active',
                gmailLabelName: 'Active Client',
                postLabelPrompt: buildDefaultProjectFollowUpPrompt('Active Client'),
                postLabelPromptDirectionScope: 'incoming',
            },
            normalizedMessage: { messageId: 'message-1' },
            gmailEmail: 'person@example.com',
            direction: 'outgoing',
        })

        expect(result.status).toBe('skipped')
        expect(assistantHelper.getAssistantForChat).not.toHaveBeenCalled()
    })

    test('keeps custom mode classifier prompt and labels unchanged', async () => {
        const config = await resolveEffectiveGmailLabelingConfig(
            {
                enabled: true,
                promptMode: 'custom',
                prompt: 'Custom prompt',
                labelDefinitions: [
                    {
                        key: 'custom',
                        gmailLabelName: 'Custom',
                        description: 'Custom rule',
                        postLabelPrompt: 'Create a custom follow-up',
                    },
                ],
            },
            {}
        )

        expect(config.prompt).toBe('Custom prompt')
        expect(config.labelDefinitions[0].postLabelPrompt).toBe('Create a custom follow-up')
    })

    test('prefers project assistant when resolving default assistant id', async () => {
        const projectGet = jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ assistantId: 'assistant-project' }),
        })
        const projectDocRef = { get: projectGet }
        const docMock = admin.__mock.doc
        docMock.mockImplementation(path => {
            if (path === 'projects/default-project') return projectDocRef
            return { path }
        })

        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])

        const assistantId = await getDefaultAssistantIdForProject(
            { defaultAssistantId: 'assistant-user' },
            'default-project'
        )

        expect(assistantId).toBe('assistant-project')
    })

    test('falls back to global default assistant when project has none', async () => {
        const projectGet = jest.fn().mockResolvedValue({
            exists: false,
            data: () => ({}),
        })
        const collectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] })
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') return { get: projectGet }
            return { path }
        })
        admin.__mock.collection.mockImplementation(() => ({
            limit: () => ({
                get: collectionGet,
            }),
        }))
        assistantsFirestore.getDefaultAssistantData.mockResolvedValue({ uid: 'assistant-global' })

        const assistantId = await getDefaultAssistantIdForProject({}, 'default-project')

        expect(assistantId).toBe('assistant-global')
    })

    test('skips follow-up execution when prompt is empty', async () => {
        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: { key: 'urgent', postLabelPrompt: '   ' },
            normalizedMessage: { messageId: 'message-1' },
            gmailEmail: 'person@example.com',
        })

        expect(result.status).toBe('skipped')
        expect(result.executedToolCallsCount).toBe(0)
    })

    test('records a completed follow-up with executed tools', async () => {
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') {
                return {
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ assistantId: 'assistant-project' }),
                    }),
                }
            }
            return { path }
        })
        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])
        assistantHelper.getAssistantForChat.mockResolvedValue({
            model: 'MODEL_GPT5_4',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be useful',
            allowedTools: ['create_task'],
            displayName: 'Default Assistant',
        })
        assistantHelper.interactWithChatStream.mockResolvedValue({})
        assistantHelper.collectAssistantTextWithToolCalls.mockResolvedValue({
            assistantResponse: 'Created a task with the email link.',
            executedToolCallsCount: 1,
            executedToolNames: ['create_task'],
            finalConversation: [{ role: 'user', content: 'context' }],
        })
        assistantHelper.calculateTokens.mockReturnValue(420)
        assistantHelper.calculateGoldCostFromTokens.mockReturnValue(2)

        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: {
                key: 'urgent',
                gmailLabelName: 'Alldone/Urgent',
                postLabelPrompt: 'Create a task for this email',
            },
            normalizedMessage: {
                messageId: 'message-1',
                threadId: 'thread-1',
                from: '"Eva-Maria Würz" <sender@example.com>',
                to: 'me@example.com',
                cc: '',
                date: 'Tue, 11 Mar 2026 10:00:00 +0100',
                subject: 'Urgent request',
                snippet: 'Please respond today',
                bodyText: 'Please respond today',
            },
            gmailEmail: 'person@example.com',
        })

        expect(result.status).toBe('completed')
        expect(result.executedToolNames).toEqual(['create_task'])
        expect(result.assistantResponse).toBe('Created a task with the email link.')
        expect(result.goldSpent).toBe(2)
        expect(result.estimatedNormalGoldCost).toBe(2)
        expect(result.tokenUsage).toEqual({ totalTokens: 420 })
        expect(deductGold).toHaveBeenCalledWith(
            'user-1',
            2,
            expect.objectContaining({
                source: 'gmail_label_follow_up',
                channel: 'gmail',
            })
        )
        expect(assistantHelper.collectAssistantTextWithToolCalls).toHaveBeenCalledWith(
            expect.objectContaining({
                toolRuntimeContext: expect.objectContaining({
                    gmailContext: {
                        origin: 'gmail_label_follow_up',
                        gmailEmail: 'person@example.com',
                        projectId: 'default-project',
                        messageId: 'message-1',
                        threadId: 'thread-1',
                        webUrl: 'https://mail.google.com/mail/u/0/?authuser=person%40example.com#all/message-1',
                        archiveOnComplete: true,
                        direction: 'incoming',
                        targetContactEmail: 'sender@example.com',
                        targetContactName: 'Eva-Maria Würz',
                    },
                }),
            })
        )
        expect(assistantHelper.interactWithChatStream).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.arrayContaining([
                    'user',
                    expect.stringContaining(
                        'Target contact email: sender@example.com\nTarget contact name: Eva-Maria Würz'
                    ),
                ]),
            ]),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything()
        )
    })

    test('records blocked follow-up when assistant tool execution is not permitted', async () => {
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') {
                return {
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ assistantId: 'assistant-project' }),
                    }),
                }
            }
            return { path }
        })
        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])
        assistantHelper.getAssistantForChat.mockResolvedValue({
            model: 'MODEL_GPT5_4',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be useful',
            allowedTools: ['get_tasks'],
            displayName: 'Default Assistant',
        })
        assistantHelper.interactWithChatStream.mockResolvedValue({})
        assistantHelper.collectAssistantTextWithToolCalls.mockRejectedValue(
            new Error('Tool not permitted: create_task')
        )

        const result = await executePostLabelPrompt({
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            selectedDefinition: {
                key: 'urgent',
                gmailLabelName: 'Alldone/Urgent',
                postLabelPrompt: 'Create a task for this email',
            },
            normalizedMessage: {
                messageId: 'message-1',
                threadId: 'thread-1',
                subject: 'Urgent request',
                bodyText: 'Please respond today',
            },
            gmailEmail: 'person@example.com',
        })

        expect(result.status).toBe('blocked')
        expect(result.error).toContain('Tool not permitted')
        expect(result.goldSpent).toBe(0)
    })

    test('outgoing processing runs follow-up only for external To recipients and stores them in audit', async () => {
        const auditSet = jest.fn().mockResolvedValue(undefined)
        admin.firestore.mockImplementation(() => ({
            getAll: admin.__mock.getAll,
            doc: admin.__mock.doc,
            collection: jest.fn(path => {
                if (path === 'users') {
                    return {
                        doc: jest.fn(() => ({
                            get: jest.fn().mockResolvedValue({ data: () => ({ gold: 99 }) }),
                            collection: jest.fn(collectionName => {
                                if (collectionName !== 'private') return { doc: jest.fn() }

                                return {
                                    doc: jest.fn(() => ({
                                        collection: jest.fn(nestedCollectionName => {
                                            if (nestedCollectionName !== 'messages') return { doc: jest.fn() }

                                            return {
                                                doc: jest.fn(() => ({
                                                    get: jest.fn().mockResolvedValue({ exists: false }),
                                                    set: auditSet,
                                                })),
                                            }
                                        }),
                                    })),
                                }
                            }),
                        })),
                    }
                }

                return {
                    limit: () => ({
                        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
                    }),
                }
            }),
        }))
        admin.__mock.doc.mockImplementation(path => {
            if (path === 'projects/default-project') {
                return {
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ assistantId: 'assistant-project' }),
                    }),
                }
            }

            return {
                path,
                get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            }
        })
        admin.__mock.getAll.mockResolvedValue([{ exists: true }, { exists: false }])
        classifyGmailMessage.mockResolvedValue({
            matched: true,
            labelKey: 'urgent',
            confidence: 0.95,
            reasoning: 'Matched outgoing follow-up',
            usage: { totalTokens: 100 },
        })
        assistantHelper.getAssistantForChat.mockResolvedValue({
            model: 'MODEL_GPT5_4',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be useful',
            allowedTools: ['create_task'],
            displayName: 'Default Assistant',
        })
        assistantHelper.interactWithChatStream.mockResolvedValue({})
        assistantHelper.collectAssistantTextWithToolCalls.mockResolvedValue({
            assistantResponse: 'Created a task with the email link.',
            executedToolCallsCount: 1,
            executedToolNames: ['create_task'],
            finalConversation: [{ role: 'user', content: 'context' }],
        })
        assistantHelper.calculateTokens.mockReturnValue(420)
        assistantHelper.calculateGoldCostFromTokens.mockReturnValue(2)

        const gmail = {
            users: {
                messages: {
                    modify: jest.fn().mockResolvedValue({}),
                },
                labels: {
                    create: jest.fn().mockResolvedValue({ data: { id: 'label-1' } }),
                },
            },
        }

        const result = await processSingleMessage({
            gmail,
            labelMap: new Map(),
            config: {
                model: 'MODEL_GPT5_4',
                labelDefinitions: [
                    {
                        key: 'urgent',
                        gmailLabelName: 'Alldone/Urgent',
                        autoArchive: true,
                        directionScope: 'outgoing',
                        postLabelPrompt: 'Create a task for this email',
                    },
                ],
                updatedAt: 'prompt-version',
            },
            userId: 'user-1',
            userData: { defaultProjectId: 'default-project' },
            projectId: 'project-1',
            gmailEmail: 'me@example.com',
            rawMessage: {
                id: 'message-1',
                threadId: 'thread-1',
                internalDate: '1710000000000',
                labelIds: ['SENT'],
                payload: {
                    headers: [
                        { name: 'From', value: 'Me <me@example.com>' },
                        {
                            name: 'To',
                            value:
                                'Me <me@example.com>, Alice <alice@example.com>, Bob <bob@example.com>, Alice <alice@example.com>',
                        },
                        { name: 'Cc', value: 'Carol <carol@example.com>' },
                        { name: 'Bcc', value: 'Dave <dave@example.com>' },
                        { name: 'Subject', value: 'Follow up' },
                        { name: 'Date', value: 'Tue, 11 Mar 2026 10:00:00 +0100' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Please handle this').toString('base64url') },
                },
                snippet: 'Please handle this',
            },
            syncRunId: 'sync-1',
        })

        expect(result.labeled).toBe(1)
        expect(assistantHelper.collectAssistantTextWithToolCalls).toHaveBeenCalledTimes(2)
        expect(assistantHelper.collectAssistantTextWithToolCalls).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                toolRuntimeContext: expect.objectContaining({
                    gmailContext: expect.objectContaining({
                        direction: 'outgoing',
                        targetContactEmail: 'alice@example.com',
                        targetContactName: 'Alice',
                    }),
                }),
            })
        )
        expect(assistantHelper.collectAssistantTextWithToolCalls).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                toolRuntimeContext: expect.objectContaining({
                    gmailContext: expect.objectContaining({
                        direction: 'outgoing',
                        targetContactEmail: 'bob@example.com',
                        targetContactName: 'Bob',
                    }),
                }),
            })
        )
        expect(auditSet).toHaveBeenCalledWith(
            expect.objectContaining({
                recipientEmails: ['alice@example.com', 'bob@example.com'],
                postLabelActions: expect.arrayContaining([
                    expect.objectContaining({ status: 'completed' }),
                    expect.objectContaining({ status: 'completed' }),
                ]),
            }),
            { merge: true }
        )
    })
})
