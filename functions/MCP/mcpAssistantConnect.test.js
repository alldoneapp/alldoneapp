jest.mock(
    'firebase-admin',
    () => ({
        firestore: jest.fn(),
    }),
    { virtual: true }
)

jest.mock(
    'firebase-functions/v2/https',
    () => ({
        HttpsError: class HttpsError extends Error {
            constructor(code, message) {
                super(message)
                this.code = code
            }
        },
    }),
    { virtual: true }
)

jest.mock(
    'uuid',
    () => ({
        v4: jest.fn(() => 'generated-server-id'),
    }),
    { virtual: true }
)

jest.mock('../Assistant/mcpClient', () => ({
    listTools: jest.fn(),
}))

const admin = require('firebase-admin')
const mcpClient = require('../Assistant/mcpClient')
const { connectAssistantMcpServer } = require('./mcpAssistantConnect')

describe('connectAssistantMcpServer diagnostics', () => {
    let infoSpy
    let secretSet
    let transactionUpdate

    beforeEach(() => {
        jest.clearAllMocks()
        infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
        secretSet = jest.fn().mockResolvedValue(undefined)
        transactionUpdate = jest.fn()

        const assistantSnapshot = {
            exists: true,
            data: () => ({ mcpServers: [] }),
        }
        const projectSnapshot = {
            exists: true,
            data: () => ({ userIds: ['private-user-id'] }),
        }
        const doc = jest.fn(docPath => {
            if (docPath === 'projects/private-project-id') {
                return { get: jest.fn().mockResolvedValue(projectSnapshot) }
            }
            if (docPath === 'assistants/private-project-id/items/private-assistant-id') {
                return { get: jest.fn().mockResolvedValue(assistantSnapshot) }
            }
            if (docPath === 'assistants/private-project-id/mcpSecrets/private-assistant-id__server-1') {
                return { set: secretSet }
            }
            throw new Error(`Unexpected test document path: ${docPath}`)
        })
        const runTransaction = jest.fn(async callback =>
            callback({
                get: jest.fn().mockResolvedValue(assistantSnapshot),
                update: transactionUpdate,
            })
        )
        admin.firestore.mockReturnValue({ doc, runTransaction })
    })

    afterEach(() => {
        infoSpy.mockRestore()
    })

    const connect = () =>
        connectAssistantMcpServer({
            userId: 'private-user-id',
            projectId: 'private-project-id',
            assistantId: 'private-assistant-id',
            server: {
                id: 'server-1',
                label: 'Private server label',
                url: 'https://secret.example/mcp',
                transport: 'http',
                authType: 'bearer',
            },
            secret: { token: 'top-secret-token' },
        })

    test('logs tools/list and persistence phases without connection data', async () => {
        mcpClient.listTools.mockResolvedValue([{ name: 'private_tool' }, { name: 'second_tool' }])

        await expect(connect()).resolves.toEqual(
            expect.objectContaining({
                success: true,
                serverId: 'server-1',
                toolCount: 2,
            })
        )

        expect(secretSet).toHaveBeenCalledWith(expect.objectContaining({ authType: 'bearer' }), { merge: true })
        expect(transactionUpdate).toHaveBeenCalledTimes(1)
        expect(infoSpy.mock.calls.map(([, diagnostic]) => diagnostic.phase)).toEqual([
            'tools_list_start',
            'tools_list_complete',
            'persistence_start',
            'persistence_complete',
        ])
        expect(JSON.stringify(infoSpy.mock.calls)).not.toMatch(
            /secret\.example|top-secret-token|private-user-id|private-project-id|private-assistant-id|Private server label|private_tool/
        )
    })

    test('logs tools/list failure without the remote error text', async () => {
        mcpClient.listTools.mockRejectedValue(
            new Error('Request to https://secret.example/mcp failed with token top-secret-token')
        )

        await expect(connect()).rejects.toMatchObject({ code: 'failed-precondition' })

        expect(infoSpy.mock.calls.map(([, diagnostic]) => diagnostic.phase)).toEqual([
            'tools_list_start',
            'tools_list_failed',
        ])
        expect(JSON.stringify(infoSpy.mock.calls)).not.toMatch(/secret\.example|top-secret-token/)
        expect(secretSet).not.toHaveBeenCalled()
        expect(transactionUpdate).not.toHaveBeenCalled()
    })

    test('logs persistence failure without serializing the secret', async () => {
        mcpClient.listTools.mockResolvedValue([])
        secretSet.mockRejectedValue(new Error('Write failed for top-secret-token'))

        await expect(connect()).rejects.toThrow('Write failed')

        expect(infoSpy.mock.calls.map(([, diagnostic]) => diagnostic.phase)).toEqual([
            'tools_list_start',
            'tools_list_complete',
            'persistence_start',
            'persistence_failed',
        ])
        expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('top-secret-token')
    })
})
