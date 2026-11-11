const {
    VM_AGENT_TEMPLATES,
    VM_SANDBOX_MEMORY_MB,
    isTemplateNotFoundError,
    createAgentSandbox,
} = require('./vmTemplates')

describe('vmTemplates', () => {
    const quietLog = { error: jest.fn() }

    beforeEach(() => quietLog.error.mockClear())

    test('each agent has a sized template built from its managed one', () => {
        expect(VM_AGENT_TEMPLATES.claude).toEqual({ sized: 'alldone-claude-4gb', managed: 'claude' })
        expect(VM_AGENT_TEMPLATES.codex).toEqual({ sized: 'alldone-codex-4gb', managed: 'codex' })
        expect(VM_SANDBOX_MEMORY_MB).toBe(4096)
    })

    test('recognises a missing template from the e2b@1.x error shape', () => {
        expect(isTemplateNotFoundError(new Error("404: template 'alldone-claude-4gb' not found"))).toBe(true)
        expect(isTemplateNotFoundError(new Error('Template alldone-codex-4gb not found'))).toBe(true)
        expect(isTemplateNotFoundError(new Error('500: internal error'))).toBe(false)
        expect(isTemplateNotFoundError(new Error('Rate limit exceeded, please try again later.'))).toBe(false)
        expect(isTemplateNotFoundError(null)).toBe(false)
    })

    test('creates from the sized template when it exists', async () => {
        const sandbox = { sandboxId: 'sbx-1' }
        const Sandbox = { create: jest.fn(async () => sandbox) }
        const opts = { apiKey: 'k' }

        const result = await createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.codex, opts, { log: quietLog })

        expect(Sandbox.create).toHaveBeenCalledTimes(1)
        expect(Sandbox.create).toHaveBeenCalledWith('alldone-codex-4gb', opts)
        expect(result).toEqual({ sandbox, template: 'alldone-codex-4gb', fellBack: false })
        expect(quietLog.error).not.toHaveBeenCalled()
    })

    test('falls back to the managed template only when the sized one is missing', async () => {
        const sandbox = { sandboxId: 'sbx-2' }
        const Sandbox = {
            create: jest.fn(async template => {
                if (template === 'alldone-claude-4gb') throw new Error("404: template 'alldone-claude-4gb' not found")
                return sandbox
            }),
        }

        const result = await createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.claude, {}, { log: quietLog })

        expect(Sandbox.create.mock.calls.map(call => call[0])).toEqual(['alldone-claude-4gb', 'claude'])
        expect(result).toEqual({ sandbox, template: 'claude', fellBack: true })
        expect(quietLog.error).toHaveBeenCalledTimes(1)
    })

    test('rethrows any other create error without trying the managed template', async () => {
        const Sandbox = {
            create: jest.fn(async () => {
                throw new Error('Rate limit exceeded, please try again later.')
            }),
        }

        await expect(createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.claude, {}, { log: quietLog })).rejects.toThrow(
            /Rate limit/
        )
        expect(Sandbox.create).toHaveBeenCalledTimes(1)
    })
})
