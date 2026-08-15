const fs = require('fs')
const path = require('path')

const { getMemorySnapshot, logMcpConnectPhase } = require('./mcpConnectDiagnostics')

describe('MCP connection deployment configuration', () => {
    test('allocates 512MiB to connectAssistantMcpServer', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
        const registration = source.match(
            /exports\.connectAssistantMcpServer\s*=\s*onCall\(\s*\{(?<options>.*?)\}\s*,/s
        )

        expect(registration).not.toBeNull()
        expect(registration.groups.options).toMatch(/memory:\s*'512MiB'/)
    })
})

describe('MCP connection diagnostics', () => {
    let infoSpy
    let memoryUsageSpy

    beforeEach(() => {
        infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
        memoryUsageSpy = jest.spyOn(process, 'memoryUsage').mockReturnValue({
            rss: 300 * 1024 * 1024,
            heapTotal: 150 * 1024 * 1024,
            heapUsed: 100 * 1024 * 1024,
            external: 20 * 1024 * 1024,
            arrayBuffers: 10 * 1024 * 1024,
        })
    })

    afterEach(() => {
        infoSpy.mockRestore()
        memoryUsageSpy.mockRestore()
    })

    test('reports only memory values and allowlisted operational details', () => {
        const diagnostic = logMcpConnectPhase('tools_list_complete', {
            durationMs: 12.7,
            toolCount: 4,
            url: 'https://secret.example/mcp',
            token: 'top-secret-token',
            userId: 'private-user-id',
            error: 'remote response with user data',
        })

        expect(diagnostic).toEqual({
            event: 'mcp_connect_phase',
            phase: 'tools_list_complete',
            rssMiB: 300,
            heapUsedMiB: 100,
            externalMiB: 20,
            arrayBuffersMiB: 10,
            durationMs: 13,
            toolCount: 4,
        })
        expect(JSON.stringify(infoSpy.mock.calls)).not.toMatch(
            /secret\.example|top-secret-token|private-user-id|remote response/
        )
    })

    test('replaces unknown phases instead of logging caller-provided text', () => {
        const diagnostic = logMcpConnectPhase('https://secret.example/mcp')

        expect(diagnostic.phase).toBe('unknown')
        expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('secret.example')
    })

    test('returns a fixed-shape memory snapshot', () => {
        expect(getMemorySnapshot()).toEqual({
            rssMiB: 300,
            heapUsedMiB: 100,
            externalMiB: 20,
            arrayBuffersMiB: 10,
        })
    })
})
