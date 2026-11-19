const {
    VM_AGENT_TEMPLATES,
    VM_SANDBOX_MEMORY_MB,
    VM_SANDBOX_CPU_COUNT,
    isTemplateNotFoundError,
    createAgentSandbox,
} = require('./vmTemplates')

describe('vmTemplates', () => {
    const quietLog = { error: jest.fn() }

    beforeEach(() => quietLog.error.mockClear())

    test('each agent has a sized template built from its managed one', () => {
        expect(VM_AGENT_TEMPLATES.claude).toEqual({
            sized: 'alldone-claude-8gb',
            previous: ['alldone-claude-4gb'],
            managed: 'claude',
        })
        expect(VM_AGENT_TEMPLATES.codex).toEqual({
            sized: 'alldone-codex-8gb',
            previous: ['alldone-codex-4gb'],
            managed: 'codex',
        })
        expect(VM_SANDBOX_MEMORY_MB).toBe(8192)
        expect(VM_SANDBOX_CPU_COUNT).toBe(4)
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
        expect(Sandbox.create).toHaveBeenCalledWith('alldone-codex-8gb', opts)
        expect(result).toEqual({ sandbox, template: 'alldone-codex-8gb', fellBack: false })
        expect(quietLog.error).not.toHaveBeenCalled()
    })

    test('falls back to the previous sized template when the new one is missing', async () => {
        const sandbox = { sandboxId: 'sbx-2' }
        const Sandbox = {
            create: jest.fn(async template => {
                if (template === 'alldone-claude-8gb') throw new Error("404: template 'alldone-claude-8gb' not found")
                return sandbox
            }),
        }

        const result = await createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.claude, {}, { log: quietLog })

        expect(Sandbox.create.mock.calls.map(call => call[0])).toEqual(['alldone-claude-8gb', 'alldone-claude-4gb'])
        expect(result).toEqual({ sandbox, template: 'alldone-claude-4gb', fellBack: true })
        expect(quietLog.error).toHaveBeenCalledTimes(1)
    })

    test('falls back to the managed template only when no sized one exists', async () => {
        const sandbox = { sandboxId: 'sbx-3' }
        const Sandbox = {
            create: jest.fn(async template => {
                if (template !== 'claude') throw new Error(`404: template '${template}' not found`)
                return sandbox
            }),
        }

        const result = await createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.claude, {}, { log: quietLog })

        expect(Sandbox.create.mock.calls.map(call => call[0])).toEqual([
            'alldone-claude-8gb',
            'alldone-claude-4gb',
            'claude',
        ])
        expect(result).toEqual({ sandbox, template: 'claude', fellBack: true })
        expect(quietLog.error).toHaveBeenCalledTimes(2)
    })

    test('throws when even the managed template is missing', async () => {
        const Sandbox = {
            create: jest.fn(async template => {
                throw new Error(`404: template '${template}' not found`)
            }),
        }

        await expect(createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.codex, {}, { log: quietLog })).rejects.toThrow(
            /404: template 'codex'/
        )
        expect(Sandbox.create).toHaveBeenCalledTimes(3)
    })

    test('rethrows a non-missing error from a previous sized template', async () => {
        const sandbox = { sandboxId: 'sbx-4' }
        const Sandbox = {
            create: jest.fn(async template => {
                if (template === 'alldone-codex-8gb') throw new Error('Template alldone-codex-8gb not found')
                if (template === 'alldone-codex-4gb') throw new Error('500: internal error')
                return sandbox
            }),
        }

        await expect(createAgentSandbox(Sandbox, VM_AGENT_TEMPLATES.codex, {}, { log: quietLog })).rejects.toThrow(
            /500/
        )
        expect(Sandbox.create.mock.calls.map(call => call[0])).toEqual(['alldone-codex-8gb', 'alldone-codex-4gb'])
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
