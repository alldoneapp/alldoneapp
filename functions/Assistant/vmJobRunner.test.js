const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const mockSendWhatsAppMessageWithConversationLink = jest.fn()
const mockMirrorAssistantResultToWhatsAppDailyTopic = jest.fn(async () => ({ mirrored: true, reason: 'stored' }))
const originalCloudRunJob = process.env.CLOUD_RUN_JOB
process.env.CLOUD_RUN_JOB = 'vm-job-runner'
const mockDeductGold = jest.fn()
const mockRefundGold = jest.fn()
const mockGetObjectFollowersIds = jest.fn()
const mockCreateInitialStatusMessage = jest.fn()
const mockResolveWorkflowRunsForSettledVmJob = jest.fn(async () => 1)
const mockFirestore = jest.fn(() => ({
    doc: jest.fn(),
}))
mockFirestore.Timestamp = { now: jest.fn(() => ({ seconds: 123, nanoseconds: 0 })) }
mockFirestore.FieldValue = { increment: jest.fn(value => ({ __op: 'increment', value })) }

jest.mock('firebase-admin', () => ({
    firestore: mockFirestore,
}))

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: mockFirestore.FieldValue,
    Timestamp: mockFirestore.Timestamp,
}))

jest.mock('../Feeds/globalFeedsHelper', () => ({
    getObjectFollowersIds: mockGetObjectFollowersIds,
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY: 'allProjects',
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
    getBaseUrl: jest.fn(() => 'https://app.alldone.test'),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({})),
}))

jest.mock('./vmJob', () => ({
    VM_JOB_GOLD_SOURCE: 'vm_execution',
    VM_JOB_GOLD_REFUND_SOURCE: 'vm_execution_refund',
    VM_GOLD_PER_MINUTE: 10,
    VM_TOKENS_PER_GOLD: 100,
    getAgentLabel: jest.fn(agent => (agent === 'codex' ? 'Codex' : 'Claude')),
    formatAgentRunSuffix: (model, effort) => {
        const parts = []
        if (model) {
            const opusVersion = /^claude-opus-(\d+)(?:-(\d+))?/.exec(model)
            parts.push(
                model === 'opus'
                    ? 'Opus latest; resolving version…'
                    : opusVersion
                      ? `Opus ${opusVersion[1]}.${opusVersion[2] || '0'}`
                      : model
            )
        }
        if (effort) parts.push(`${effort} effort`)
        return parts.length ? ` (${parts.join(' · ')})` : ''
    },
    // Mirrors the real signature, including the credentialLabel override the OpenRouter BYOK route
    // depends on (AT-2230) — a stub that silently drops it would make this file's header tests lie.
    formatVmBillingStatus: (agentLabel, credentialMode, _agentModel = '', _tokensPerGold = 0, credentialLabel = '') => {
        const mode = typeof credentialMode === 'boolean' ? (credentialMode ? 'subscription' : 'api') : credentialMode
        if (mode === 'subscription') return `🔐 Using your ${agentLabel} subscription. VM tokens will not cost Gold.`
        if (mode === 'byok') return `🔐 Using your personal ${credentialLabel || agentLabel} API key.`
        return '🔑 Using Alldone API billing. VM tokens will cost Gold.'
    },
    DEFAULT_CLAUDE_MODEL: 'opus',
    DEFAULT_CODEX_MODEL: 'gpt-5.6-sol',
    DEFAULT_CLAUDE_EFFORT_LEVEL: 'high',
    DEFAULT_CODEX_REASONING_EFFORT: 'medium',
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendWhatsAppMessageWithConversationLink: mockSendWhatsAppMessageWithConversationLink,
    }))
)

jest.mock('../WhatsApp/whatsAppResultMirror', () => ({
    mirrorAssistantResultToWhatsAppDailyTopic: (...args) => mockMirrorAssistantResultToWhatsAppDailyTopic(...args),
}))

jest.mock('../Gold/goldHelper', () => ({
    deductGold: mockDeductGold,
    refundGold: mockRefundGold,
}))

jest.mock('./assistantStatusHelper', () => ({
    createInitialStatusMessage: mockCreateInitialStatusMessage,
}))

jest.mock('../Tasks/workflowAiStep', () => ({
    resolveWorkflowRunsForSettledVmJob: mockResolveWorkflowRunsForSettledVmJob,
}))

const { __private__ } = require('./vmJobRunner')

afterAll(() => {
    if (originalCloudRunJob === undefined) delete process.env.CLOUD_RUN_JOB
    else process.env.CLOUD_RUN_JOB = originalCloudRunJob
})

describe('VM workflow completion handoff', () => {
    beforeEach(() => {
        mockResolveWorkflowRunsForSettledVmJob.mockClear()
    })

    test('re-reads the terminal job and immediately resolves its parked workflow', async () => {
        const pendingRef = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    kind: 'vm_job',
                    projectId: 'mutable-project',
                    objectType: 'tasks',
                    objectId: 'mutable-task',
                    status: 'completed',
                }),
            })),
        }
        const immutableContext = {
            correlationId: 'vm-1',
            kind: 'vm_job',
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            assistantId: 'assistant-1',
            callbackContext: {
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
            },
        }

        await expect(__private__.resolveWorkflowAfterVmJobSettlement(pendingRef, immutableContext)).resolves.toBe(1)
        expect(mockResolveWorkflowRunsForSettledVmJob).toHaveBeenCalledWith(
            expect.objectContaining({
                correlationId: 'vm-1',
                projectId: 'project-1',
                objectId: 'task-1',
                status: 'completed',
            })
        )
    })
})

describe('VM runner prompt', () => {
    const baseVmJob = {
        taskType: 'prototype',
        objective: 'Check whether the repo needs a code change.',
    }

    test('tells text-only jobs not to create an output artifact', () => {
        const prompt = __private__.buildAgentPrompt({
            ...baseVmJob,
            taskType: 'research',
            objective: 'Answer in chat.',
        })

        expect(prompt).toContain('Do not create an output file just to return a normal text/chat answer')
        expect(prompt).toContain('Put the answer directly in your final message unless the user asked for a file')
    })

    test('keeps task-thread delivery owned by the invoking assistant host', () => {
        const prompt = __private__.buildAgentPrompt(baseVmJob)

        expect(prompt).toContain('The VM host owns all task-thread delivery')
        expect(prompt).toContain(
            'Do not use an Alldone app, MCP tool, API, or task-update/comment tool to post your result'
        )
        expect(prompt).toContain('Return normal output in your final message')
        expect(prompt).toContain('ask through the native interaction mechanism')
    })

    test('only asks for a GitHub pull request when repository files changed', () => {
        const prompt = __private__.buildAgentPrompt(baseVmJob, {
            enabled: true,
            provider: 'github',
            baseBranch: 'main',
        })

        expect(prompt).toContain(
            'Only deliver the work as a GitHub Pull Request when you actually changed repository files'
        )
        expect(prompt).toContain('If there is no repository diff, do NOT commit, push, or open a Pull/Merge Request')
        expect(prompt).toContain(
            'If you made no repository changes, your final message MUST say that no Pull Request was opened'
        )
        expect(prompt).toContain('Repository dependencies may already be pre-installed at /home/user/repo/node_modules')
        expect(prompt).toContain(
            'if /home/user/repo/node_modules already exists and the lockfile is unchanged, skip installation entirely'
        )
        expect(prompt).toContain(
            'Only install when the requested change or a necessary lint/test/build verification actually requires it, and never for explanation-only work'
        )
        expect(prompt).toContain('use the INCREMENTAL installer (npm install / yarn install / pnpm install)')
        expect(prompt).toContain('do NOT run a clean install (npm ci')
        expect(prompt).not.toContain('runner has already performed a best-effort dependency install')
        expect(prompt).toContain('retry before reporting failure')
    })

    test('only asks for a GitLab merge request when repository files changed', () => {
        const prompt = __private__.buildAgentPrompt(baseVmJob, {
            enabled: true,
            provider: 'gitlab',
            baseBranch: 'main',
        })

        expect(prompt).toContain(
            'Only deliver the work as a GitLab Merge Request when you actually changed repository files'
        )
        expect(prompt).toContain('If there is no repository diff, do NOT commit, push, or open a Pull/Merge Request')
        expect(prompt).toContain(
            'If you made no repository changes, your final message MUST say that no Merge Request was opened'
        )
    })

    test('renders live activity with the selected VM agent', () => {
        expect(__private__.renderVmWorkingHeader('Codex')).toBe('🖥️ Working with Codex in a VM…')
        expect(__private__.renderActivityLog(['💻 npm run lint'], 'Claude')).toContain(
            '🖥️ Working with Claude in a VM…'
        )
    })

    // AT-2230 BYOK: the live header names the KEY SLOT, not the harness. An OpenRouter run is driven
    // by the Codex agent, so "your personal Codex API key" would point the user at the wrong
    // Settings card the moment the key stops working.
    test('the live header names the OpenRouter key slot for an OpenRouter run', () => {
        expect(
            __private__.renderVmWorkingHeader('Codex', { model: 'openrouter:deepseek/deepseek-chat' }, 'byok')
        ).toContain('your personal Codex API key')
        expect(
            __private__.renderVmWorkingHeader(
                'Codex',
                { model: 'openrouter:deepseek/deepseek-chat' },
                'byok',
                'OpenRouter'
            )
        ).toContain('your personal OpenRouter API key')
        expect(
            __private__.renderActivityLog(['💻 npm run lint'], 'Codex', { model: '' }, 'byok', 'OpenRouter')
        ).toContain('your personal OpenRouter API key')
    })

    test('an Alldone Gold header is unchanged and quotes no rate (the launch comment owns that)', () => {
        const header = __private__.renderVmWorkingHeader('Codex', { model: 'gpt-5.6-sol' }, 'api')
        expect(header).toContain('Using Alldone API billing')
        // Re-deriving a rate here could print a number different from the one frozen on the job.
        expect(header).not.toContain('Sol rate')
    })

    test('preserves complete multiline Claude progress updates', () => {
        const progressText = `First line\n\n${'Complete Claude update. '.repeat(20).trim()}`
        const state = { activity: [], finalResult: '', assistantText: '', usage: null }

        __private__.appendClaudeActivity(
            {
                type: 'assistant',
                message: { content: [{ type: 'text', text: `  ${progressText}  ` }] },
            },
            state
        )

        expect(state.activity).toEqual([`💬 ${progressText}`])
        expect(__private__.renderActivityLog(state.activity, 'Claude')).toContain(progressText)
    })

    test('preserves complete Codex progress and reasoning updates', () => {
        const progressText = `Codex update\n${'All details stay visible. '.repeat(20).trim()}`
        const reasoningText = `Reasoning summary\n${'No detail is removed. '.repeat(20).trim()}`
        const state = { activity: [], finalResult: '', assistantText: '', usage: null }

        __private__.appendCodexActivity(
            { type: 'item.completed', item: { type: 'agent_message', text: progressText } },
            state
        )
        __private__.appendCodexActivity(
            { type: 'item.completed', item: { type: 'reasoning', text: reasoningText } },
            state
        )

        expect(state.activity).toEqual([`💬 ${progressText}`, `💭 ${reasoningText}`])
        expect(__private__.renderActivityLog(state.activity, 'Codex')).toContain(progressText)
        expect(__private__.renderActivityLog(state.activity, 'Codex')).toContain(reasoningText)
    })

    test('header includes the model and effort the agent is running with', () => {
        expect(
            __private__.renderVmWorkingHeader('Claude', {
                model: 'opus',
                resolvedModel: 'claude-opus-5',
                effort: 'high',
            })
        ).toBe('🖥️ Working with Claude (Opus 5.0 · high effort) in a VM…')
        expect(
            __private__.renderActivityLog(['💻 npm run lint'], 'Codex', { model: 'gpt-5.5', effort: 'medium' })
        ).toBe('🖥️ Working with Codex (gpt-5.5 · medium effort) in a VM…\n\n💻 npm run lint')
    })

    test('header omits the suffix when neither model nor effort is known', () => {
        expect(__private__.renderVmWorkingHeader('Claude', { model: '', effort: '' })).toBe(
            '🖥️ Working with Claude in a VM…'
        )
    })

    test('header identifies personal API-key routing without exposing a key', () => {
        const header = __private__.renderVmWorkingHeader('Claude', { model: 'claude-opus-5', effort: 'high' }, 'byok')
        expect(header).toContain('Using your personal Claude API key')
        expect(header).not.toContain('sk-')
    })

    test('resolveAgentRunDetails falls back to per-agent defaults when the job omits them', () => {
        expect(__private__.resolveAgentRunDetails({ agent: 'claude' })).toEqual({ model: 'opus', effort: 'high' })
        expect(__private__.resolveAgentRunDetails({ agent: 'codex' })).toEqual({
            model: 'gpt-5.6-sol',
            effort: 'medium',
        })
    })

    test('resolveAgentRunDetails uses explicit job values when present', () => {
        expect(
            __private__.resolveAgentRunDetails({ agent: 'codex', agentModel: 'gpt-5.4', agentReasoningEffort: 'low' })
        ).toEqual({ model: 'gpt-5.4', effort: 'low' })
    })

    test('resolveAgentRunDetails preserves the moving Opus alias before execution', () => {
        expect(
            __private__.resolveAgentRunDetails({
                agent: 'claude',
                agentModel: 'opus',
                agentReasoningEffort: 'high',
            })
        ).toEqual({ model: 'opus', effort: 'high' })
    })

    test('passes the moving Opus alias unchanged to automatic Claude runs', () => {
        const command = __private__.buildClaudeRunCommand(false, 'opus', 'high')
        expect(command).toContain('--model opus')
        expect(command).not.toContain('claude-opus-5')
    })

    test('resolveAgentRunDetails restores a previously observed concrete model', () => {
        expect(
            __private__.resolveAgentRunDetails({
                agent: 'claude',
                agentModel: 'opus',
                resolvedAgentModel: 'claude-opus-4-8',
            })
        ).toEqual({ model: 'opus', effort: 'high', resolvedModel: 'claude-opus-4-8' })
    })

    test.each([
        [
            {
                type: 'system',
                subtype: 'init',
                model: 'claude-opus-4-8',
            },
            'claude-opus-4-8',
        ],
        [
            {
                type: 'assistant',
                parent_tool_use_id: null,
                message: { model: 'claude-opus-5' },
            },
            'claude-opus-5',
        ],
        [
            {
                type: 'assistant',
                parent_tool_use_id: 'tool-1',
                message: { model: 'claude-sonnet-5' },
            },
            null,
        ],
        [
            {
                type: 'assistant',
                parent_tool_use_id: null,
                message: { model: '<synthetic>' },
            },
            null,
        ],
    ])('extracts a safe concrete model from Claude runtime event %#', (event, expected) => {
        expect(__private__.resolveRuntimeAgentModel(event, 'claude')).toBe(expected)
        expect(__private__.resolveRuntimeAgentModel(event, 'codex')).toBeNull()
    })

    test('updates the live header after Claude resolves the moving alias', () => {
        const runDetails = { model: 'opus', effort: 'high' }
        const event = { type: 'system', subtype: 'init', model: 'claude-opus-4-8' }

        expect(__private__.applyRuntimeAgentModel(event, 'claude', runDetails)).toBe('claude-opus-4-8')
        expect(runDetails).toEqual({ model: 'opus', effort: 'high', resolvedModel: 'claude-opus-4-8' })
        expect(__private__.renderVmWorkingHeader('Claude', runDetails)).toBe(
            '🖥️ Working with Claude (Opus 4.8 · high effort) in a VM…'
        )
        expect(__private__.applyRuntimeAgentModel(event, 'claude', runDetails)).toBeNull()
    })
})

describe('VM interactive agent bridge', () => {
    test('keeps automatic execution off the bridge and gates interactive rollout explicitly', () => {
        expect(__private__.isInteractiveVmExecutionEnabled({})).toBe(false)
        expect(__private__.isInteractiveVmExecutionEnabled({ VM_INTERACTIVE_EXECUTION_ENABLED: 'true' })).toBe(true)
        expect(
            __private__.isInteractiveVmExecutionEnabled({ VM_INTERACTIVE_USER_IDS: 'user-1, user-2' }, 'user-2')
        ).toBe(true)
    })

    test('moves plan-first from planning to execution only after approval', () => {
        expect(__private__.resolveVmInteractionPhase('plan_first', {})).toBe('planning')
        expect(
            __private__.resolveVmInteractionPhase('plan_first', {
                interactionPhase: 'planning',
                answeredInteraction: { kind: 'plan_review' },
                interactionResponse: { action: 'approve' },
            })
        ).toBe('executing')
        expect(
            __private__.resolveVmInteractionPhase('plan_first', {
                answeredInteraction: { kind: 'plan_review' },
                interactionResponse: { action: 'revise' },
            })
        ).toBe('planning')
        expect(__private__.resolveVmInteractionPhase('interactive', {})).toBe('executing')
    })

    test('builds a provider continuation turn without repeating the original objective', () => {
        const prompt = __private__.buildVmBridgeTurnPrompt(
            'ORIGINAL OBJECTIVE',
            {
                interactionProviderState: { threadId: 'thread-1' },
                answeredInteraction: { kind: 'clarification' },
                interactionResponse: {
                    action: 'submit',
                    answers: { approach: ['Safe'], 'details:other': 'Keep the API compatible' },
                },
            },
            'planning'
        )
        expect(prompt).toContain('approach: Safe')
        expect(prompt).toContain('details:other: Keep the API compatible')
        expect(prompt).toContain('Continue planning without making changes')
        expect(prompt).not.toContain('ORIGINAL OBJECTIVE')
    })

    test('uses native plan mode and then autonomous execution for plan-first', () => {
        const planning = __private__.buildVmAgentBridgeInput({
            vmJob: { agent: 'claude', executionMode: 'plan_first' },
            pendingWebhook: {},
            workdir: '/repo',
            prompt: 'Plan this',
            runDetails: { model: 'opus', effort: 'high' },
            agentCredentials: { mode: 'subscription' },
            additionalWritableRoots: ['/home/user/git-metadata'],
        })
        expect(planning).toMatchObject({
            model: 'opus',
            effort: 'high',
            phase: 'planning',
            permissionMode: 'plan',
            additionalDirectories: ['/home/user/git-metadata'],
            settingSources: ['user', 'project', 'local'],
        })

        const executing = __private__.buildVmAgentBridgeInput({
            vmJob: { agent: 'claude', executionMode: 'plan_first' },
            pendingWebhook: {
                interactionProviderState: { sessionId: 'session-1' },
                answeredInteraction: { kind: 'plan_review' },
                interactionResponse: { action: 'approve' },
            },
            workdir: '/repo',
            prompt: 'Plan this',
            runDetails: { model: 'opus', effort: 'high' },
            agentCredentials: { mode: 'subscription' },
            additionalWritableRoots: ['/home/user/git-metadata'],
        })
        expect(executing).toMatchObject({
            phase: 'executing',
            permissionMode: 'bypassPermissions',
            additionalDirectories: ['/home/user/git-metadata'],
            settingSources: ['user', 'project', 'local'],
        })
        expect(executing.prompt).toContain('approved the plan')
    })

    test('uses Codex native auto-review for interactive execution', () => {
        const input = __private__.buildVmAgentBridgeInput({
            vmJob: { agent: 'codex', executionMode: 'interactive' },
            pendingWebhook: {},
            workdir: '/repo',
            prompt: 'Implement this',
            runDetails: { model: 'gpt-5.6-sol', effort: 'medium' },
            agentCredentials: { mode: 'subscription' },
            additionalWritableRoots: ['/home/user/git-metadata'],
        })

        expect(input).toMatchObject({
            phase: 'executing',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
        })
        expect(input.codexArgs).toEqual(
            expect.arrayContaining([
                'features.apps=false',
                'sandbox_mode="workspace-write"',
                'sandbox_workspace_write.writable_roots=["/home/user/git-metadata"]',
                'sandbox_workspace_write.network_access=true',
            ])
        )
    })

    test.each([
        { agent: 'claude', executionMode: 'plan_first' },
        { agent: 'claude', executionMode: 'interactive' },
        { agent: 'codex', executionMode: 'plan_first' },
        { agent: 'codex', executionMode: 'interactive' },
    ])('keeps Git metadata writable for $agent in $executionMode mode', ({ agent, executionMode }) => {
        const pendingWebhook =
            executionMode === 'plan_first'
                ? {
                      answeredInteraction: { kind: 'plan_review' },
                      interactionResponse: { action: 'approve' },
                  }
                : {}
        const input = __private__.buildVmAgentBridgeInput({
            vmJob: { agent, executionMode },
            pendingWebhook,
            workdir: '/home/user/repo',
            prompt: 'Implement this',
            runDetails: { model: agent === 'claude' ? 'opus' : 'gpt-5.6-sol', effort: 'medium' },
            agentCredentials: { mode: 'subscription' },
            additionalWritableRoots: [' /home/user/git-metadata ', '/home/user/git-metadata', '', null],
        })

        expect(input.phase).toBe('executing')
        if (agent === 'claude') {
            expect(input.additionalDirectories).toEqual(['/home/user/git-metadata'])
            expect(input.settingSources).toEqual(['user', 'project', 'local'])
        } else {
            expect(input.codexArgs).toEqual(
                expect.arrayContaining([
                    'features.apps=false',
                    'sandbox_mode="workspace-write"',
                    'sandbox_workspace_write.writable_roots=["/home/user/git-metadata"]',
                    'sandbox_workspace_write.network_access=true',
                ])
            )
        }
    })

    test('adds disk-backed runtime storage only when a repo checkout needs an extra writable root', () => {
        expect(__private__.buildVmAdditionalWritableRoots({ enabled: true })).toEqual([
            '/home/user/git-metadata',
            '/home/user/.cache/alldone-vm',
        ])
        expect(__private__.buildVmAdditionalWritableRoots({ enabled: false })).toEqual([])
        expect(__private__.buildVmAdditionalWritableRoots(null)).toEqual([])
    })
})

describe('VM agent CLI bootstrap and proxy configuration', () => {
    let cliTestDir
    let prefix
    let npmLogPath

    function writeClaudeBinary(version, executable = true) {
        const binaryPath = path.join(prefix, 'bin', 'claude')
        fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
        fs.writeFileSync(binaryPath, `#!/usr/bin/env bash\nprintf '%s (Claude Code)\\n' '${version}'\n`)
        fs.chmodSync(binaryPath, executable ? 0o755 : 0o644)
        return binaryPath
    }

    function installFakeNpm() {
        const fakeNpmPath = path.join(prefix, 'bin', 'npm')
        fs.mkdirSync(path.dirname(fakeNpmPath), { recursive: true })
        fs.writeFileSync(
            fakeNpmPath,
            [
                // Absolute interpreter path so the shim runs without needing `node` on the
                // hermetic PATH that runClaudeInstallGuard sets (host `node` lives next to the
                // real `claude`, which we deliberately keep off that PATH).
                `#!${process.execPath}`,
                "const fs = require('fs')",
                "const path = require('path')",
                'const args = process.argv.slice(2)',
                "fs.appendFileSync(process.env.FAKE_NPM_LOG, `${args.join(' ')}\\n`)",
                "if (args[0] === 'view') {",
                '    process.stdout.write(`${process.env.FAKE_NPM_LATEST}\\n`)',
                '    process.exit(0)',
                '}',
                "if (args[0] !== 'install') process.exit(2)",
                'const binaryPath = process.env.FAKE_CLI_PATH',
                'if (fs.existsSync(binaryPath)) {',
                '    process.stderr.write(`npm error code EEXIST\\nnpm error path ${binaryPath}\\n`)',
                '    process.exit(17)',
                '}',
                "if (process.env.FAKE_NPM_FAIL_INSTALL === '1') {",
                "    process.stderr.write('npm error simulated registry failure\\n')",
                '    process.exit(19)',
                '}',
                'fs.mkdirSync(path.dirname(binaryPath), { recursive: true })',
                'fs.writeFileSync(',
                '    binaryPath,',
                "    `#!/usr/bin/env bash\\nprintf '%s (Claude Code)\\\\n' '${process.env.FAKE_NPM_LATEST}'\\n`",
                ')',
                'fs.chmodSync(binaryPath, 0o755)',
            ].join('\n')
        )
        fs.chmodSync(fakeNpmPath, 0o755)
    }

    // The install guard hard-requires `flock` (a per-agent process lock). `flock` ships with
    // util-linux on the Linux CI image but is absent on macOS, so without this shim the guard
    // exits at its first line and these tests fail only on macOS dev machines. Shim it onto the
    // guard's prepended PATH — exactly like the fake npm above — so the lock acquires as a no-op
    // and the tests exercise the real install/upgrade/backup logic on any host. (The presence of
    // the lock in the emitted script itself is asserted separately via `buildCodexInstallGuard`.)
    function installFakeFlock() {
        const fakeFlockPath = path.join(prefix, 'bin', 'flock')
        fs.mkdirSync(path.dirname(fakeFlockPath), { recursive: true })
        fs.writeFileSync(fakeFlockPath, '#!/usr/bin/env bash\nexit 0\n')
        fs.chmodSync(fakeFlockPath, 0o755)
    }

    function runClaudeInstallGuard(latestVersion = '2.1.0', failInstall = false) {
        const command = __private__.buildClaudeInstallGuard({
            prefix,
            lockPath: path.join(cliTestDir, 'claude-install.lock'),
        })
        const wrappedCommand = `bash -lc '${command.replace(/'/g, `'\\''`)}'`
        return childProcess.execFileSync('bash', ['-lc', wrappedCommand], {
            encoding: 'utf8',
            env: {
                ...process.env,
                // Hermetic PATH: only the shimmed prefix/bin (fake npm, fake flock, and any
                // test-managed claude) plus system dirs. This keeps the host's real claude/npm
                // (installed in ~/.local/bin on dev machines) from leaking in via `command -v`,
                // which otherwise makes a "missing"/"stale" launcher resolve to the real CLI and
                // reports the wrong installed version. CI passed only because its PATH is clean.
                PATH: `${path.join(prefix, 'bin')}:/usr/bin:/bin`,
                FAKE_CLI_PATH: path.join(prefix, 'bin', 'claude'),
                FAKE_NPM_LATEST: latestVersion,
                FAKE_NPM_LOG: npmLogPath,
                FAKE_NPM_FAIL_INSTALL: failInstall ? '1' : '0',
            },
        })
    }

    beforeEach(() => {
        cliTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-cli-bootstrap-'))
        prefix = path.join(cliTestDir, 'prefix')
        npmLogPath = path.join(cliTestDir, 'npm.log')
        installFakeNpm()
        installFakeFlock()
    })

    afterEach(() => {
        fs.rmSync(cliTestDir, { recursive: true, force: true })
    })

    test('checks and installs the latest Codex CLI under a process lock', () => {
        const guard = __private__.buildCodexInstallGuard()

        expect(guard).toContain("export PATH='/home/user/.local/bin':$PATH")
        expect(guard).toContain('AGENT_CLI_INSTALLING')
        expect(guard).toContain("package_name='@openai/codex'")
        expect(guard).toContain("binary_name='codex'")
        expect(guard).toContain('npm view "$package_name" version --silent')
        expect(guard).toContain('npm install -g --prefix "$cli_prefix" "$package_name@$latest_version"')
        expect(guard).toContain('flock -w 300')
    })

    test('installs Claude Code into an empty prefix', () => {
        const output = runClaudeInstallGuard()

        expect(output).toContain('AGENT_CLI_INSTALLING from=missing-or-invalid to=2.1.0')
        expect(output).toContain('AGENT_CLI_READY installed 2.1.0')
        expect(fs.readFileSync(npmLogPath, 'utf8')).toContain(
            'install -g --prefix ' + prefix + ' @anthropic-ai/claude-code@2.1.0'
        )
    })

    test('accepts an already-current Claude CLI without running npm install', () => {
        writeClaudeBinary('2.1.0')

        const output = runClaudeInstallGuard()

        expect(output).toBe('AGENT_CLI_READY existing 2.1.0\n')
        expect(fs.readFileSync(npmLogPath, 'utf8').trim()).toBe('view @anthropic-ai/claude-code version --silent')
    })

    test('upgrades an older Claude CLI and removes its temporary backup', () => {
        const binaryPath = writeClaudeBinary('2.0.0')

        const output = runClaudeInstallGuard()

        expect(output).toContain('AGENT_CLI_INSTALLING from=2.0.0 to=2.1.0')
        expect(childProcess.execFileSync(binaryPath, ['--version'], { encoding: 'utf8' })).toBe('2.1.0 (Claude Code)\n')
        expect(fs.readdirSync(path.dirname(binaryPath)).filter(name => name.includes('.alldone-backup.'))).toEqual([])
    })

    test('moves a stale launcher aside so npm cannot fail with EEXIST', () => {
        const binaryPath = writeClaudeBinary('stale launcher', false)

        const output = runClaudeInstallGuard()

        expect(output).toContain('AGENT_CLI_INSTALLING from=missing-or-invalid to=2.1.0')
        expect(childProcess.execFileSync(binaryPath, ['--version'], { encoding: 'utf8' })).toBe('2.1.0 (Claude Code)\n')
        expect(fs.readdirSync(path.dirname(binaryPath)).filter(name => name.includes('.alldone-backup.'))).toEqual([])
    })

    test('restores the previous launcher when npm fails during an upgrade', () => {
        const binaryPath = writeClaudeBinary('2.0.0')

        expect(() => runClaudeInstallGuard('2.1.0', true)).toThrow()
        expect(childProcess.execFileSync(binaryPath, ['--version'], { encoding: 'utf8' })).toBe('2.0.0 (Claude Code)\n')
    })

    test('reports a fresh VM check before a separate installation stage', async () => {
        const onActivity = jest.fn()
        const sandbox = {
            commands: {
                run: jest.fn(async (_command, options) => {
                    options.onStdout(
                        'AGENT_CLI_INSTALLING from=missing-or-invalid to=2.1.0\nnpm notice package metadata\n'
                    )
                    options.onStderr('npm ERR! Authorization: Bearer secret-token\nregistry unavailable')
                    throw new Error('exit status 1')
                }),
            },
        }

        await expect(
            __private__.ensureAgentCliAvailable(
                sandbox,
                { installGuard: __private__.buildClaudeInstallGuard },
                'Claude',
                onActivity,
                'Working'
            )
        ).rejects.toThrow(
            'Claude installation failed. stdout: npm notice package metadata stderr: npm ERR! Authorization: Bearer [REDACTED] registry unavailable'
        )
        expect(onActivity).toHaveBeenNthCalledWith(1, 'Working\n\n🆕 Starting a fresh VM and checking Claude…')
        expect(onActivity).toHaveBeenCalledWith('Working\n\n📦 Installing Claude…')
        expect(sandbox.commands.run).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                envs: {
                    NPM_CONFIG_CACHE: '/home/user/.cache/alldone-vm/npm',
                    TMPDIR: '/home/user/.cache/alldone-vm/tmp',
                },
            })
        )
    })

    test('reports an update, rather than an install, when a resumed VM has an older CLI', async () => {
        const onActivity = jest.fn()
        const sandbox = {
            commands: {
                run: jest.fn(async (_command, options) => {
                    // Exercise markers split across command-stream chunks too.
                    options.onStdout('AGENT_CLI_INSTALLING from=1.9')
                    options.onStdout('.0 to=2.1.0\nAGENT_CLI_READY installed 2.1.0\n')
                }),
            },
        }

        await __private__.ensureAgentCliAvailable(
            sandbox,
            { installGuard: 'check-agent-cli' },
            'Codex',
            onActivity,
            'Working',
            { isResume: true }
        )

        expect(onActivity.mock.calls).toEqual([
            ['Working\n\n🔄 Resuming VM and checking Codex for updates…'],
            ['Working\n\n⬆️ Updating Codex from 1.9.0 to 2.1.0…'],
        ])
    })

    test('only reports the update check when a resumed VM already has the latest CLI', async () => {
        const onActivity = jest.fn()
        const sandbox = {
            commands: {
                run: jest.fn(async (_command, options) => {
                    options.onStdout('AGENT_CLI_READY existing 2.1.0\n')
                }),
            },
        }

        await __private__.ensureAgentCliAvailable(
            sandbox,
            { installGuard: 'check-agent-cli' },
            'Claude',
            onActivity,
            'Working',
            { isResume: true }
        )

        expect(onActivity).toHaveBeenCalledTimes(1)
        expect(onActivity).toHaveBeenCalledWith('Working\n\n🔄 Resuming VM and checking Claude for updates…')
    })

    test('reports Node ENOSPC exit status 228 as exhausted VM temporary storage', () => {
        const error = new Error('exit status 228')
        error.exitCode = 228

        expect(__private__.buildStageError('Claude bootstrap', error).message).toBe(
            'Claude bootstrap failed. The VM ran out of temporary storage (ENOSPC).'
        )
    })

    test('prepares disk-backed runtime directories and migrates the legacy tmpfs npm cache', async () => {
        const sandbox = { commands: { run: jest.fn(async () => ({})) } }
        const setupCommand = __private__.buildVmRuntimeSetupCommand()

        await __private__.prepareVmRuntimeDirectories(sandbox)

        expect(sandbox.commands.run).toHaveBeenCalledWith(expect.any(String), { timeoutMs: 5 * 60 * 1000 })
        expect(setupCommand).toContain("mv '/tmp/alldone-npm-cache' '/home/user/.cache/alldone-vm/npm'")
        expect(setupCommand).toContain("ln -s '/home/user/.cache/alldone-vm/npm' '/tmp/alldone-npm-cache'")
        expect(setupCommand).toContain("mkdir -p '/home/user/.cache/alldone-vm'")
    })

    test('preserves a structured Claude error on a non-zero exit and redacts secrets', () => {
        const error = __private__.buildAgentExitError(
            'Claude',
            { exitCode: 1 },
            { finalResult: 'Authentication failed for sk-ant-super-secret', assistantText: '' },
            'request aborted'
        )

        expect(error.message).toBe(
            'Claude exited with exit status 1. Authentication failed for [REDACTED] request aborted'
        )
        expect(error.message).not.toContain('super-secret')
    })

    test('recognizes provider-specific subscription authentication failures', () => {
        expect(
            __private__.isVmSubscriptionAuthError(
                new Error('401 Unauthorized: {"code":"refresh_token_reused"}'),
                'codex'
            )
        ).toBe(true)
        expect(
            __private__.isVmSubscriptionAuthError(new Error('OAuth token has expired. Please log in again.'), 'claude')
        ).toBe(true)
        expect(
            __private__.isVmSubscriptionAuthError(new Error('Invalid OAuth token. Please run /login.'), 'claude')
        ).toBe(true)
        expect(__private__.isVmSubscriptionAuthError(new Error('Repository returned 401'), 'codex')).toBe(false)
    })

    test('only marks a pre-work subscription auth failure as safe to retry', () => {
        const preWorkError = __private__.markSafeVmSubscriptionAuthRetry(
            new Error('refresh token was already used'),
            'codex',
            { activity: ['Failed to refresh token: refresh token was already used'] }
        )
        const warningOnlyError = __private__.markSafeVmSubscriptionAuthRetry(
            new Error('401 Unauthorized: {"code":"refresh_token_reused"}'),
            'codex',
            {
                activity: ['⚠️ Unexpected status 401 Unauthorized'],
                usage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheTokens: 0,
                    totalTokens: 0,
                    costUsd: null,
                },
            }
        )
        const afterWorkError = __private__.markSafeVmSubscriptionAuthRetry(
            new Error('OAuth token has expired'),
            'claude',
            { activity: ['💻 Created a pull request'] }
        )
        const afterUsageError = __private__.markSafeVmSubscriptionAuthRetry(
            new Error('refresh token was already used'),
            'codex',
            { activity: [], usage: { totalTokens: 1 } }
        )

        expect(preWorkError.vmAuthRetrySafe).toBe(true)
        expect(warningOnlyError.vmAuthRetrySafe).toBe(true)
        expect(afterWorkError.vmAuthRetrySafe).toBe(false)
        expect(afterUsageError.vmAuthRetrySafe).toBe(false)
    })

    test('marks a zero-exit no-output subscription auth failure as safe to retry', () => {
        const state = {
            activity: ['Failed to refresh token: refresh token was already used'],
            finalResult: '',
            assistantText: '',
            usage: null,
        }
        const error = __private__.buildAgentExitErrorWithAuthRetry(
            'Codex',
            { exitCode: 0 },
            state,
            '401 Unauthorized: {"code":"refresh_token_reused"}',
            'codex',
            new Error('Agent produced no output.')
        )

        expect(error.message).toContain('Codex exited with exit status 0.')
        expect(error.message).toContain('refresh_token_reused')
        expect(error.vmAuthRetrySafe).toBe(true)
    })

    test('waits for a newer subscription credential before retrying', async () => {
        let clock = 0
        const loadAuth = jest
            .fn()
            .mockResolvedValueOnce({ credentialVersion: 'old-version' })
            .mockResolvedValueOnce({ credentialVersion: 'new-version', credential: 'new-token' })
        const wait = jest.fn(async ms => {
            clock += ms
        })

        await expect(
            __private__.waitForVmSubscriptionAuthChange('user-1', 'claude', 'old-version', {
                timeoutMs: 100,
                pollMs: 10,
                loadAuth,
                wait,
                now: () => clock,
            })
        ).resolves.toEqual({ credentialVersion: 'new-version', credential: 'new-token' })
        expect(loadAuth).toHaveBeenLastCalledWith('user-1', 'claude', { markUsed: false })
        expect(wait).toHaveBeenCalledTimes(1)
    })

    test('stops auth recovery without blindly retrying the same credential', async () => {
        let clock = 0
        const wait = jest.fn(async ms => {
            clock += ms
        })

        await expect(
            __private__.waitForVmSubscriptionAuthChange('user-1', 'codex', 'same-version', {
                timeoutMs: 20,
                pollMs: 10,
                loadAuth: jest.fn(async () => ({ credentialVersion: 'same-version' })),
                wait,
                now: () => clock,
            })
        ).resolves.toBeNull()
        expect(wait).toHaveBeenCalledTimes(2)
    })

    test('routes Codex through the HTTP proxy and disables Responses WebSockets', () => {
        const overrides = __private__.buildCodexProxyConfigOverrides('https://vm-proxy.example/functions/vmLlmProxy/')

        expect(overrides).toEqual(
            expect.arrayContaining([
                'model_provider="alldone_vm_proxy"',
                'model_providers.alldone_vm_proxy.base_url="https://vm-proxy.example/functions/vmLlmProxy/openai/v1"',
                'model_providers.alldone_vm_proxy.env_key="OPENAI_API_KEY"',
                'model_providers.alldone_vm_proxy.wire_api="responses"',
                'model_providers.alldone_vm_proxy.supports_websockets=false',
            ])
        )
    })

    test('includes the HTTP-only provider on fresh and resumed Codex runs', () => {
        for (const isResume of [false, true]) {
            const command = __private__.buildCodexRunCommand(
                isResume,
                'gpt-5.5',
                'high',
                'https://vm-proxy.example/vmLlmProxy',
                false,
                ['/home/user/git-metadata']
            )

            expect(command).toContain(`-c 'model_provider="alldone_vm_proxy"'`)
            expect(command).toContain(
                `-c 'model_providers.alldone_vm_proxy.base_url="https://vm-proxy.example/vmLlmProxy/openai/v1"'`
            )
            expect(command).toContain(`-c 'model_providers.alldone_vm_proxy.supports_websockets=false'`)
            expect(command).toContain(`-c 'features.apps=false'`)
            expect(command).toContain(`-c 'sandbox_mode="workspace-write"'`)
            expect(command).toContain(`-c 'sandbox_workspace_write.writable_roots=["/home/user/git-metadata"]'`)
            expect(command).not.toContain('--sandbox')
        }
    })

    test('omits the Git metadata writable root when the run has no connected repository', () => {
        const command = __private__.buildCodexRunCommand(
            false,
            'gpt-5.5',
            'high',
            'https://vm-proxy.example/vmLlmProxy'
        )

        expect(command).toContain(`-c 'sandbox_workspace_write.writable_roots=[]'`)
        expect(command).not.toContain('/home/user/git-metadata')
    })

    test('uses the native ChatGPT login without the API proxy for subscription runs', () => {
        const command = __private__.buildCodexRunCommand(false, 'gpt-5.6-sol', 'medium', undefined, true)

        // Shell-quoted since AT-2230: an OpenRouter id carries `/` and may carry `:`.
        expect(command).toContain(`--model 'gpt-5.6-sol'`)
        expect(command).toContain('-c model_reasoning_effort=medium')
        expect(command).toContain(`-c 'features.apps=false'`)
        expect(command).not.toContain('alldone_vm_proxy')
    })

    test('rejects malformed proxy URLs instead of allowing a direct Codex request', () => {
        expect(() => __private__.buildCodexProxyConfigOverrides('')).toThrow('Codex VM proxy base URL is invalid.')
        expect(() => __private__.buildCodexProxyConfigOverrides('file:///tmp/proxy')).toThrow(
            'Codex VM proxy base URL must use HTTP or HTTPS.'
        )
    })
})

describe('VM Git checkout setup', () => {
    test('refreshes cold golden checkouts while preserving resumed branches', () => {
        const childProcess = require('child_process')
        const fs = require('fs')
        const os = require('os')
        const path = require('path')
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alldone-vm-git-'))
        const seed = path.join(root, 'seed')
        const origin = path.join(root, 'origin.git')
        const workTree = path.join(root, 'checkout')
        const gitDir = path.join(root, 'metadata', 'repo')
        const home = path.join(root, 'home')
        fs.mkdirSync(seed)
        fs.mkdirSync(home)

        const run = (command, options = {}) =>
            childProcess.execFileSync('bash', ['-c', command], {
                cwd: options.cwd || root,
                env: { ...process.env, HOME: home, ...(options.env || {}) },
                stdio: 'pipe',
            })

        run('git init -b main', { cwd: seed })
        fs.writeFileSync(path.join(seed, 'README.md'), 'seed\n')
        run('git add README.md && git -c user.name=Test -c user.email=test@example.com commit -m seed', { cwd: seed })
        run(`git clone --bare ${JSON.stringify(seed)} ${JSON.stringify(origin)}`)

        const setupEnv = {
            GIT_TOKEN: 'test-token',
            GIT_CRED_USERNAME: 'oauth2',
            GIT_REPO_URL: origin,
            GIT_BASE_BRANCH: 'main',
            GIT_USER_NAME: 'Alldone Test',
            GIT_USER_EMAIL: 'test@alldone.app',
            GIT_DIR: gitDir,
            GIT_WORK_TREE: workTree,
        }

        run(__private__.GIT_SETUP_SCRIPT, { env: setupEnv })
        expect(fs.existsSync(path.join(workTree, '.git'))).toBe(false)
        expect(fs.existsSync(gitDir)).toBe(true)

        run(`git remote add origin ${JSON.stringify(origin)}`, { cwd: seed })
        fs.writeFileSync(path.join(seed, 'LATEST.md'), 'latest\n')
        run('git add LATEST.md && git -c user.name=Test -c user.email=test@example.com commit -m latest', {
            cwd: seed,
        })
        run('git push origin main', { cwd: seed })

        // A cold sandbox seeded from a golden snapshot has an existing checkout, but must still
        // start from the latest remote base rather than the commit baked into the snapshot.
        run(__private__.GIT_SETUP_SCRIPT, { env: { ...setupEnv, GIT_PRESERVE_WORKTREE: 'false' } })
        expect(run('git rev-parse HEAD', { cwd: workTree, env: setupEnv }).toString().trim()).toBe(
            run('git rev-parse origin/main', { cwd: workTree, env: setupEnv }).toString().trim()
        )
        expect(fs.readFileSync(path.join(workTree, 'LATEST.md'), 'utf8')).toBe('latest\n')

        run('git checkout -b ai/sandbox-safe-branch', { cwd: workTree, env: setupEnv })
        fs.writeFileSync(path.join(workTree, 'README.md'), 'in-progress work\n')
        run(__private__.GIT_SETUP_SCRIPT, { env: { ...setupEnv, GIT_PRESERVE_WORKTREE: 'true' } })
        expect(run('git rev-parse --abbrev-ref HEAD', { cwd: workTree, env: setupEnv }).toString().trim()).toBe(
            'ai/sandbox-safe-branch'
        )
        expect(fs.readFileSync(path.join(workTree, 'README.md'), 'utf8')).toBe('in-progress work\n')

        // A paused sandbox created before this fix resumes with conventional .git metadata.
        // The setup step must migrate it without losing the agent's current branch.
        fs.renameSync(gitDir, path.join(workTree, '.git'))
        run(__private__.GIT_SETUP_SCRIPT, { env: { ...setupEnv, GIT_PRESERVE_WORKTREE: 'true' } })
        expect(fs.existsSync(path.join(workTree, '.git'))).toBe(false)
        expect(run('git rev-parse --abbrev-ref HEAD', { cwd: workTree, env: setupEnv }).toString().trim()).toBe(
            'ai/sandbox-safe-branch'
        )
    })

    test('injects only the dedicated metadata location into agent git commands', () => {
        const env = __private__.buildGitEnv({
            token: 'secret',
            repoUrl: 'https://gitlab.example/repo',
            baseBranch: 'main',
            identityName: 'Assistant',
            identityEmail: 'assistant@example.com',
        })

        expect(env.GIT_DIR).toBe('/home/user/git-metadata/repo')
        expect(env.GIT_WORK_TREE).toBe('/home/user/repo')
    })
})

describe('VM runner runtime Gold monitor', () => {
    const pendingWebhook = {
        correlationId: 'correlation-1',
        userId: 'user-1',
        goldCharged: 20,
        projectId: 'project-1',
        objectType: 'topics',
        objectId: 'chat-1',
    }
    const vmJob = { agent: 'claude' }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('deducts newly accrued runtime Gold while balance remains positive', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }
        mockDeductGold.mockResolvedValue({ success: true, amount: 10, newBalance: 40 })

        const charged = await __private__.checkAndChargeVmRuntimeGold({
            pendingWebhook,
            pendingRef,
            commandHandle,
            runStartMs: 0,
            runtimeGoldCharged: 0,
            vmJob,
            now: () => 60000,
            getCurrentGold: jest.fn(async () => 50),
        })

        expect(charged).toBe(10)
        expect(mockDeductGold).toHaveBeenCalledWith(
            'user-1',
            10,
            expect.objectContaining({
                source: 'vm_execution',
                projectId: 'project-1',
                objectId: 'chat-1',
            })
        )
        expect(pendingRef.update).toHaveBeenCalledWith({ runtimeGoldCharged: 10 })
        expect(commandHandle.kill).not.toHaveBeenCalled()
    })

    test('continues metering accumulated active runtime without charging time spent waiting for the user', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }
        mockDeductGold.mockResolvedValue({ success: true, amount: 10, newBalance: 40 })

        const charged = await __private__.checkAndChargeVmRuntimeGold({
            pendingWebhook,
            pendingRef,
            commandHandle,
            runStartMs: 100000,
            activeRuntimeOffsetMs: 30000,
            runtimeGoldCharged: 0,
            vmJob,
            now: () => 130000,
            getCurrentGold: jest.fn(async () => 50),
        })

        expect(charged).toBe(10)
        expect(mockDeductGold).toHaveBeenCalledWith('user-1', 10, expect.any(Object))
    })

    test('kills the command when balance is already zero', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }

        await expect(
            __private__.checkAndChargeVmRuntimeGold({
                pendingWebhook,
                pendingRef,
                commandHandle,
                runStartMs: 0,
                runtimeGoldCharged: 0,
                vmJob,
                now: () => 60000,
                getCurrentGold: jest.fn(async () => 0),
            })
        ).rejects.toMatchObject({ code: 'insufficient_gold', runtimeGoldCharged: 0 })

        expect(mockDeductGold).not.toHaveBeenCalled()
        expect(commandHandle.kill).toHaveBeenCalled()
    })

    test('deducts remaining positive balance and then kills when charge cannot be fully paid', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }
        mockDeductGold.mockResolvedValue({ success: true, amount: 1, newBalance: 0 })

        await expect(
            __private__.checkAndChargeVmRuntimeGold({
                pendingWebhook,
                pendingRef,
                commandHandle,
                runStartMs: 0,
                runtimeGoldCharged: 0,
                vmJob,
                now: () => 120000,
                getCurrentGold: jest.fn(async () => 1),
            })
        ).rejects.toMatchObject({ code: 'insufficient_gold', runtimeGoldCharged: 1 })

        expect(mockDeductGold).toHaveBeenCalledWith('user-1', 1, expect.any(Object))
        expect(pendingRef.update).toHaveBeenCalledWith({ runtimeGoldCharged: 1 })
        expect(commandHandle.kill).toHaveBeenCalled()
    })

    test('completion top-up excludes runtime Gold already charged by the monitor', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 125000,
            usage: { totalTokens: 250 },
            runtimeGoldCharged: 2,
        })

        expect(charges).toEqual(
            expect.objectContaining({
                minutes: 3,
                runtimeGoldRemaining: 28,
                tokenGold: 3,
                topup: 31,
            })
        )
    })

    test('completion top-up excludes token Gold already charged by the proxy', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 350 },
            runtimeGoldCharged: 1,
            proxyTokenGoldCharged: 2,
        })

        expect(charges).toEqual(
            expect.objectContaining({
                minutes: 2,
                runtimeGoldRemaining: 19,
                proxyTokenGoldCharged: 2,
                tokenGoldTotal: 4,
                tokenGold: 2,
                topup: 21,
            })
        )
    })

    // AT-2230 pricing: the settlement half of per-model Gold rates. Runtime Gold pays for the E2B
    // sandbox and must NOT move with the model — only the token line does.
    test('each model settles token Gold at its own researched rate, with runtime Gold unchanged', () => {
        const args = { runtimeMs: 61000, usage: { totalTokens: 250_000 } }
        const sol = __private__.calculateCompletionGoldCharges({ ...args, agentModel: 'gpt-5.6-sol' })
        const luna = __private__.calculateCompletionGoldCharges({ ...args, agentModel: 'gpt-5.6-luna' })
        const deepSeekPro = __private__.calculateCompletionGoldCharges({
            ...args,
            agentModel: 'openrouter:deepseek/deepseek-v4-pro',
        })

        expect(sol.tokensPerGold).toBe(100)
        expect(luna.tokensPerGold).toBe(2500)
        expect(deepSeekPro.tokensPerGold).toBe(1800)

        expect(sol.tokenGoldTotal).toBe(2500)
        expect(luna.tokenGoldTotal).toBe(100)
        expect(deepSeekPro.tokenGoldTotal).toBe(139)

        // Same sandbox, same compute cost, whichever model the agent talked to.
        for (const charges of [luna, deepSeekPro]) {
            expect(charges.runtimeGoldTotal).toBe(sol.runtimeGoldTotal)
            expect(charges.minutes).toBe(sol.minutes)
        }
    })

    // The rate is frozen onto the job at launch precisely so a catalog refresh mid-run cannot move
    // what the user pays. Settlement must honour that stored rate over re-deriving one.
    test('a rate persisted on the job wins over re-deriving it from the model id', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 250_000 },
            agentModel: 'openrouter:deepseek/deepseek-v4-pro',
            tokensPerGold: 5000,
        })

        expect(charges.tokensPerGold).toBe(5000)
        expect(charges.tokenGoldTotal).toBe(50)
    })

    // The two charge sites must resolve the SAME rate from the same persisted state. If settlement
    // used a different rate than the proxy had charged at, this subtraction would quietly bill the
    // difference a second time (or clamp to zero and hide an overcharge entirely).
    test('settlement nets off proxy charges made at the same rate', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 250_000 },
            agentModel: 'openrouter:deepseek/deepseek-v4-pro',
            tokensPerGold: 1800,
            proxyTokenGoldCharged: 139,
        })

        expect(charges.tokenGoldTotal).toBe(139)
        expect(charges.tokenGold).toBe(0) // fully paid live; nothing owed at the end
        expect(charges.topup).toBe(charges.runtimeGoldRemaining)
    })

    // Every OpenRouter model is priced from its own upstream cost now, not parked at one shared level.
    test('a non-DeepSeek OpenRouter model settles at its own researched rate', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 250_000 },
            agentModel: 'openrouter:qwen/qwen3-coder',
        })

        expect(charges.tokensPerGold).toBe(960)
        expect(charges.tokenGoldTotal).toBe(260)
    })

    // Existing jobs carry no agentModel on their doc; they must settle exactly as before.
    test('a job with no recorded model settles at the standard rate', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 250_000 },
        })

        expect(charges.tokensPerGold).toBe(100)
        expect(charges.tokenGoldTotal).toBe(2500)
    })

    test('a DeepSeek subscription-exempt run still charges no token Gold', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 250_000 },
            agentModel: 'openrouter:deepseek/deepseek-v4-pro',
            tokensPerGold: 1800,
            subscriptionUsed: true,
        })

        expect(charges.tokenGoldTotal).toBe(0)
        expect(charges.tokenGold).toBe(0)
    })

    test('subscription completion charges VM runtime but no token Gold', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 5000 },
            subscriptionUsed: true,
        })

        expect(charges).toEqual(
            expect.objectContaining({
                minutes: 2,
                runtimeGoldTotal: 20,
                tokenGoldTotal: 0,
                tokenGold: 0,
                topup: 20,
                subscriptionUsed: true,
            })
        )
    })

    test('technical failure refund includes base reserve plus runtime Gold already charged', async () => {
        mockRefundGold.mockResolvedValue({ success: true, amount: 23 })

        await __private__.refundVmJob(pendingWebhook, 'VM task failed during execution', 3)

        expect(mockRefundGold).toHaveBeenCalledWith(
            'user-1',
            23,
            expect.objectContaining({
                source: 'vm_execution_refund',
                note: 'VM task failed during execution',
            })
        )
    })
})

describe('VM runner cancellation monitor', () => {
    test('kills the active command and rejects when cancellation is requested', async () => {
        const pendingRef = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ status: 'cancel_requested' }),
            })),
        }
        const commandHandle = { kill: jest.fn(async () => true) }

        const monitor = __private__.startVmCancellationMonitor({
            pendingRef,
            commandHandle,
            getRuntimeGoldCharged: () => 3,
            intervalMs: 60000,
            correlationId: 'correlation-1',
        })

        await expect(monitor.promise).rejects.toMatchObject({
            code: 'vm_job_cancelled',
            runtimeGoldCharged: 3,
        })
        expect(commandHandle.kill).toHaveBeenCalled()
        monitor.stop()
    })

    test('detects cancellation status from pending webhook data', async () => {
        await expect(
            __private__.isVmJobCancellationRequested({
                get: jest.fn(async () => ({
                    exists: true,
                    data: () => ({ status: 'cancel_requested' }),
                })),
            })
        ).resolves.toBe(true)
    })
})

describe('VM runner timeout handling', () => {
    test('preserves E2B generic exit-code-2 termination instead of inventing a runtime timeout', () => {
        const originalError = new Error('2: [unknown] terminated')
        originalError.name = 'CommandExitError'
        originalError.exitCode = 2
        const detailedError = new Error('Codex exited while running focused tests')

        expect(__private__.normalizeVmCommandError(originalError)).toBe(originalError)
        expect(__private__.isVmRuntimeTimeoutError(originalError)).toBe(false)
        expect(__private__.selectVmCommandError(originalError, detailedError)).toBe(detailedError)
    })

    test.each([
        'deadline exceeded while waiting for the command',
        '[deadline_exceeded] the operation timed out',
        'command timed out',
        'sandbox timeout',
    ])('classifies a known timeout signal: %s', message => {
        expect(__private__.isE2bSandboxTimeout(new Error(message))).toBe(true)
    })

    test.each(['exit status 2', 'signal: killed', 'terminated by user', 'connection reset'])(
        'preserves a non-timeout termination: %s',
        message => {
            const originalError = new Error(message)
            expect(__private__.normalizeVmCommandError(originalError)).toBe(originalError)
            expect(__private__.isVmRuntimeTimeoutError(originalError)).toBe(false)
        }
    )

    test('preserves typed timeouts instead of replacing them with detailed CLI output', () => {
        const timeoutError = new __private__.VmRuntimeTimeoutError()
        const detailedError = new Error('Claude exited with partial agent output')

        expect(__private__.selectVmCommandError(timeoutError, detailedError)).toBe(timeoutError)
        expect(__private__.selectVmCommandError(new Error('exit status 2'), detailedError)).toBe(detailedError)
    })

    test('formats the configured limit in the user-facing timeout message', () => {
        expect(__private__.buildVmRuntimeTimeoutText()).toBe(
            '❌ The VM task exceeded its allowed execution time of 5 hours. Start a new VM task to continue.'
        )
        expect(__private__.buildVmRuntimeTimeoutText(55 * 60 * 1000)).toContain('55 minutes')
        expect(__private__.buildVmRuntimeTimeoutText(2 * 60 * 60 * 1000)).toContain('2 hours')
    })

    test('budgets each slice below the one-hour sandbox lease', () => {
        const now = 100000
        const totalDeadline = now + 5 * 60 * 60 * 1000
        expect(__private__.resolveVmAgentSliceRuntimeMs(now + 60 * 60 * 1000, totalDeadline, now)).toBe(55 * 60 * 1000)
        expect(__private__.resolveVmAgentSliceRuntimeMs(now + 50 * 60 * 1000, totalDeadline, now)).toBe(
            49.5 * 60 * 1000
        )
        expect(__private__.resolveVmAgentSliceRuntimeMs(null, totalDeadline, now)).toBe(55 * 60 * 1000)
        expect(__private__.resolveVmAgentSliceRuntimeMs(null, now + 25 * 60 * 1000, now)).toBe(25 * 60 * 1000)
    })

    test('enforces the runtime with a typed timer before E2B termination', async () => {
        jest.useFakeTimers()
        const commandHandle = { kill: jest.fn(async () => true) }
        const timeout = __private__.startVmRuntimeTimeout(commandHandle, 1000)
        const rejected = expect(timeout.promise).rejects.toMatchObject({
            code: 'runtime_timeout',
            runtimeMs: 1000,
        })

        jest.advanceTimersByTime(1000)
        await rejected

        expect(commandHandle.kill).toHaveBeenCalledTimes(1)
        timeout.stop()
        jest.useRealTimers()
    })

    test('reports the five-hour product limit when a slice ends the run', async () => {
        jest.useFakeTimers()
        const commandHandle = { kill: jest.fn(async () => true) }
        const timeout = __private__.startVmRuntimeTimeout(commandHandle, 1000, 5 * 60 * 60 * 1000)
        const rejected = expect(timeout.promise).rejects.toMatchObject({
            code: 'runtime_timeout',
            runtimeMs: 5 * 60 * 60 * 1000,
        })

        jest.advanceTimersByTime(1000)
        await rejected

        timeout.stop()
        jest.useRealTimers()
    })

    test('builds durable output paths and records the command exit code', () => {
        const paths = __private__.buildVmRunStatePaths('run/with unsafe chars')
        const command = __private__.buildDurableVmCommand('agent --json', paths)

        expect(paths).toEqual({
            stdoutPath: '/home/user/.alldone/vm-runs/run_with_unsafe_chars.stdout.jsonl',
            stderrPath: '/home/user/.alldone/vm-runs/run_with_unsafe_chars.stderr.log',
            exitCodePath: '/home/user/.alldone/vm-runs/run_with_unsafe_chars.exit-code',
            stdoutPipePath: '/home/user/.alldone/vm-runs/run_with_unsafe_chars.stdout.pipe',
            stderrPipePath: '/home/user/.alldone/vm-runs/run_with_unsafe_chars.stderr.pipe',
        })
        expect(command).toContain('tee -a')
        expect(command).toContain('mkfifo')
        expect(command).toContain('wait "$stdout_tee_pid" "$stderr_tee_pid"')
        expect(command).toContain('command_exit=$?')
        expect(command).toContain('exit "$command_exit"')
    })

    test('pauses, resumes, and reconnects to the same process between slices', async () => {
        const firstHandle = {
            pid: 42,
            wait: jest.fn(() => new Promise(() => {})),
            disconnect: jest.fn(async () => {}),
            kill: jest.fn(async () => {}),
        }
        const resumedResult = { exitCode: 0 }
        const secondHandle = {
            pid: 42,
            wait: jest.fn(async () => resumedResult),
            disconnect: jest.fn(async () => {}),
            kill: jest.fn(async () => {}),
        }
        const resumedSandbox = {
            sandboxId: 'sandbox-1',
            setTimeout: jest.fn(async () => {}),
            commands: { connect: jest.fn(async () => secondHandle) },
        }
        const Sandbox = { connect: jest.fn(async () => resumedSandbox) }
        const pauseSandbox = jest.fn(async () => {})
        const resumeSandbox = jest.fn(async () => {})
        const onCommandHandleChange = jest.fn()

        const supervision = await __private__.superviseVmCommand({
            Sandbox,
            sandbox: { sandboxId: 'sandbox-1' },
            commandHandle: firstHandle,
            e2bApiKey: 'test-key',
            sandboxLeaseDeadlineMs: Date.now() + 60000,
            pauseSandbox,
            resumeSandbox,
            resolveSliceRuntime: () => 1,
            onCommandHandleChange,
        })

        expect(firstHandle.disconnect).toHaveBeenCalledTimes(1)
        expect(pauseSandbox).toHaveBeenCalledWith('sandbox-1', 'test-key')
        expect(resumeSandbox).toHaveBeenCalledWith('sandbox-1', 'test-key', 3600)
        expect(Sandbox.connect).toHaveBeenCalledWith('sandbox-1', {
            apiKey: 'test-key',
            allowInternetAccess: true,
        })
        expect(resumedSandbox.commands.connect).toHaveBeenCalledWith(42, expect.objectContaining({ timeoutMs: 0 }))
        expect(onCommandHandleChange).toHaveBeenCalledWith(secondHandle)
        expect(supervision.result).toBe(resumedResult)
        expect(supervision.sliceCount).toBe(2)
    })
})

// A warm sandbox reused inside the keep-alive window does NOT get a fresh hour: E2B pins the
// expiry to the start of the sandbox's current session (create or resume) and ignores the
// `setTimeout()` the runner issues on reuse. Assuming a full hour scheduled the protective
// lease rotation up to ~an hour after E2B had already killed the sandbox, so the agent died
// mid-run and every following command 404'd. Measured in production on 7/7 sandbox deaths:
// each landed 3598.7-3599.4s after that sandbox's last resume, never after its creation.
describe('VM sandbox lease is measured, not assumed', () => {
    const HOUR_MS = 60 * 60 * 1000

    test('reads the real expiry E2B reports for the sandbox', async () => {
        const now = 1_000_000
        const endAt = new Date(now + 18 * 60 * 1000)
        const sandbox = { getInfo: jest.fn(async () => ({ endAt, startedAt: new Date(now - 42 * 60 * 1000) })) }

        await expect(__private__.readSandboxLeaseDeadlineMs(sandbox, now + HOUR_MS)).resolves.toBe(endAt.getTime())
        expect(sandbox.getInfo).toHaveBeenCalledTimes(1)
        // Bounded: it sits on the run's startup path.
        expect(sandbox.getInfo).toHaveBeenCalledWith(expect.objectContaining({ requestTimeoutMs: expect.any(Number) }))
    })

    test('falls back to the caller assumption rather than failing a run', async () => {
        const fallback = 5_000_000
        // No getInfo at all (older SDK / injected test double).
        await expect(__private__.readSandboxLeaseDeadlineMs({}, fallback)).resolves.toBe(fallback)
        // getInfo throws.
        await expect(
            __private__.readSandboxLeaseDeadlineMs(
                {
                    getInfo: async () => {
                        throw new Error('E2B unreachable')
                    },
                },
                fallback
            )
        ).resolves.toBe(fallback)
        // getInfo answers without a usable expiry.
        await expect(
            __private__.readSandboxLeaseDeadlineMs({ getInfo: async () => ({ endAt: undefined }) }, fallback)
        ).resolves.toBe(fallback)
        await expect(__private__.readSandboxLeaseDeadlineMs(null, fallback)).resolves.toBe(fallback)
    })

    test('keeps a genuinely fresh warm sandbox on its instant path', async () => {
        const now = 2_000_000
        // The control case from the incident: created ~9 minutes earlier, 51 minutes left.
        const endAt = new Date(now + 51 * 60 * 1000)
        const sandbox = { sandboxId: 'sandbox-warm', getInfo: async () => ({ endAt }) }
        const pauseSandbox = jest.fn(async () => {})
        const resumeSandbox = jest.fn(async () => {})

        const lease = await __private__.prepareReusedSandboxLease({
            Sandbox: { connect: jest.fn() },
            sandbox,
            sandboxId: 'sandbox-warm',
            e2bApiKey: 'test-key',
            nowMs: now,
            pauseSandbox,
            resumeSandbox,
        })

        expect(lease.rotated).toBe(false)
        expect(lease.sandbox).toBe(sandbox)
        expect(lease.leaseDeadlineMs).toBe(endAt.getTime())
        expect(pauseSandbox).not.toHaveBeenCalled()
        expect(resumeSandbox).not.toHaveBeenCalled()
    })

    test('rotates a warm sandbox that cannot hold a normal run instead of dying mid-run', async () => {
        const now = 3_000_000
        // The incident shape: reused 41.5 minutes into its hour, so 18.4 minutes remain while
        // the run needs more. Before the fix this reported a full hour of lease.
        const inheritedEndAt = new Date(now + 18.4 * 60 * 1000)
        const staleSandbox = { sandboxId: 'sandbox-stale', getInfo: async () => ({ endAt: inheritedEndAt }) }
        const rotatedSandbox = {
            sandboxId: 'sandbox-stale',
            setTimeout: jest.fn(async () => {}),
            commands: { run: jest.fn(async () => ({ exitCode: 0 })) },
            getInfo: jest.fn(async () => ({ endAt: new Date(Date.now() + HOUR_MS) })),
        }
        const Sandbox = { connect: jest.fn(async () => rotatedSandbox) }
        const pauseSandbox = jest.fn(async () => {})
        const resumeSandbox = jest.fn(async () => {})
        const probeSandbox = jest.fn(async () => {})

        const lease = await __private__.prepareReusedSandboxLease({
            Sandbox,
            sandbox: staleSandbox,
            sandboxId: 'sandbox-stale',
            e2bApiKey: 'test-key',
            nowMs: now,
            pauseSandbox,
            resumeSandbox,
            probeSandbox,
        })

        expect(lease.rotated).toBe(true)
        expect(lease.previousLeaseRemainingMs).toBeLessThan(19 * 60 * 1000)
        // pause + resume is the only call that provably re-arms E2B's clock.
        expect(pauseSandbox).toHaveBeenCalledWith('sandbox-stale', 'test-key')
        expect(resumeSandbox).toHaveBeenCalledWith('sandbox-stale', 'test-key', 3600)
        expect(Sandbox.connect).toHaveBeenCalledWith('sandbox-stale', {
            apiKey: 'test-key',
            allowInternetAccess: true,
        })
        expect(rotatedSandbox.setTimeout).toHaveBeenCalledWith(HOUR_MS)
        // A rotation is a resume, so it inherits the dead-envd hazard (E2B #884).
        expect(probeSandbox).toHaveBeenCalledWith(rotatedSandbox)
        expect(lease.sandbox).toBe(rotatedSandbox)
        expect(lease.leaseDeadlineMs - Date.now()).toBeGreaterThan(55 * 60 * 1000)
    })

    test('budgets the agent slice inside the inherited lease when no rotation happens', () => {
        const now = 4_000_000
        // A warm sandbox with 40 minutes left must not be budgeted a 55-minute slice: the
        // rotation has to be scheduled before E2B's own termination, not after it.
        const leaseDeadlineMs = now + 40 * 60 * 1000
        const totalDeadline = now + 5 * HOUR_MS
        const slice = __private__.resolveVmAgentSliceRuntimeMs(leaseDeadlineMs, totalDeadline, now)

        expect(slice).toBe(39.5 * 60 * 1000)
        expect(now + slice).toBeLessThan(leaseDeadlineMs)
    })

    test('lets a failed rotation surface so the caller starts a fresh sandbox', async () => {
        const now = 5_000_000
        const staleSandbox = { getInfo: async () => ({ endAt: new Date(now + 60 * 1000) }) }

        await expect(
            __private__.prepareReusedSandboxLease({
                Sandbox: { connect: jest.fn() },
                sandbox: staleSandbox,
                sandboxId: 'sandbox-dead',
                e2bApiKey: 'test-key',
                nowMs: now,
                pauseSandbox: jest.fn(async () => {
                    throw new Error('E2B pause 404: sandbox not found')
                }),
                resumeSandbox: jest.fn(),
            })
        ).rejects.toThrow(/pause 404/)
    })

    test('re-reads the lease after a mid-run slice rotation', async () => {
        const rotatedDeadline = 9_999_999_999
        const readLeaseDeadline = jest.fn(async () => rotatedDeadline)
        const resolveSliceRuntime = jest.fn(() => 1)
        const firstHandle = {
            pid: 7,
            wait: jest.fn(() => new Promise(() => {})),
            disconnect: jest.fn(async () => {}),
            kill: jest.fn(async () => {}),
        }
        const secondHandle = { pid: 7, wait: jest.fn(async () => ({ exitCode: 0 })), disconnect: jest.fn() }
        const resumedSandbox = {
            sandboxId: 'sandbox-1',
            setTimeout: jest.fn(async () => {}),
            commands: { connect: jest.fn(async () => secondHandle) },
        }

        await __private__.superviseVmCommand({
            Sandbox: { connect: jest.fn(async () => resumedSandbox) },
            sandbox: { sandboxId: 'sandbox-1' },
            commandHandle: firstHandle,
            e2bApiKey: 'test-key',
            sandboxLeaseDeadlineMs: Date.now() + 60000,
            pauseSandbox: jest.fn(async () => {}),
            resumeSandbox: jest.fn(async () => {}),
            resolveSliceRuntime,
            readLeaseDeadline,
        })

        expect(readLeaseDeadline).toHaveBeenCalledWith(resumedSandbox, expect.any(Number))
        // The slice after the rotation is budgeted against E2B's reported expiry, not against
        // the deadline the runner asked for.
        expect(resolveSliceRuntime).toHaveBeenCalledTimes(2)
        expect(resolveSliceRuntime.mock.calls[1][0]).toBe(rotatedDeadline)
    })

    test('treats a vanished sandbox as an unhealthy session', () => {
        // Verbatim from the production incidents.
        const vanished = new Error(`404: Sandbox "ixc8oy056mnc074n3gmyv" doesn't exist or you don't have access to it`)

        expect(__private__.isE2bSandboxMissing(vanished)).toBe(true)
        expect(__private__.isUnhealthyVmSessionError(vanished)).toBe(true)
        // A sandbox that is gone can never be kept alive, so it must not take the keep-alive
        // branch and rely on the pause/kill cascade to discover that.
        expect(__private__.isUnhealthyVmSessionError(new Error('Claude exited with exit status 1'))).toBe(false)
        expect(__private__.isE2bSandboxMissing(new Error('repository not found'))).toBe(false)
        expect(__private__.isE2bSandboxMissing(null)).toBe(false)
        // An agent-exit error carries the assistant's own narration; the model writing about a
        // sandbox must never cost the session.
        expect(
            __private__.isE2bSandboxMissing(
                new Error('Claude exited. I checked whether the sandbox was not found and it is fine.')
            )
        ).toBe(false)
        // Our own pause/resume wrapper surfaces the E2B body behind a status prefix.
        expect(
            __private__.isE2bSandboxMissing(
                new Error(`E2B pause 404: Sandbox "iqx76qos2eb5xq2xjaq53" doesn't exist or you don't have access to it`)
            )
        ).toBe(true)
    })
})

describe('VM session isolation', () => {
    test('only reuses explicitly paused or safely idle leased sessions', () => {
        expect(__private__.isReusableVmSession({ status: 'paused' })).toBe(true)
        expect(__private__.isReusableVmSession({ status: 'idle_running' })).toBe(true)
        expect(__private__.isReusableVmSession({ status: 'busy' })).toBe(false)
        expect(__private__.isReusableVmSession({ status: 'running' })).toBe(false)
    })

    test('resumes only paused sessions and connects directly to warm idle sessions', () => {
        expect(__private__.shouldResumeVmSession({ status: 'paused' })).toBe(true)
        expect(__private__.shouldResumeVmSession({})).toBe(true)
        expect(__private__.shouldResumeVmSession({ status: 'idle_running' })).toBe(false)
    })

    test('treats E2B already-running resume conflicts as safe to connect', async () => {
        const originalFetch = global.fetch
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 409,
            text: async () => '{"code":409,"message":"Sandbox sandbox-1 is already running"}',
        }))

        try {
            await expect(__private__.resumeE2bSandbox('sandbox-1', 'test-key', 3600)).resolves.toBe(false)
        } finally {
            global.fetch = originalFetch
        }
    })

    test('does not swallow unrelated E2B resume conflicts', async () => {
        const originalFetch = global.fetch
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 409,
            text: async () => '{"code":409,"message":"Sandbox transition is already in progress"}',
        }))

        try {
            await expect(__private__.resumeE2bSandbox('sandbox-1', 'test-key', 3600)).rejects.toThrow('E2B resume 409')
        } finally {
            global.fetch = originalFetch
        }
    })

    test('treats command-channel timeouts and forced agent termination as unhealthy', () => {
        expect(__private__.isUnhealthyVmSessionError(new Error('deadline exceeded while running git fetch'))).toBe(true)
        expect(__private__.isUnhealthyVmSessionError(new Error('Claude exited with exit status -1.'))).toBe(true)
        expect(__private__.isUnhealthyVmSessionError(new Error('Claude exited with exit status 2.'))).toBe(false)
    })

    test('probes a resumed sandbox with a trivial command under the short health-check timeout', async () => {
        const sandbox = { commands: { run: jest.fn(async () => ({ exitCode: 0 })) } }

        await expect(__private__.probeResumedVmSandbox(sandbox)).resolves.toBeUndefined()
        expect(sandbox.commands.run).toHaveBeenCalledWith('true', {
            timeoutMs: __private__.RESUME_HEALTHCHECK_TIMEOUT_MS,
        })
        // Must be far shorter than the multi-minute per-command budgets so a dead resume is caught
        // in seconds instead of hanging the first real command for minutes.
        expect(__private__.RESUME_HEALTHCHECK_TIMEOUT_MS).toBeLessThanOrEqual(30 * 1000)
    })

    test('propagates the timeout when a resumed sandbox comes back with a dead command channel', async () => {
        const deadline = new Error(
            "[deadline_exceeded] the operation timed out: This error is likely due to exceeding 'timeoutMs'"
        )
        const sandbox = {
            commands: {
                run: jest.fn(async () => {
                    throw deadline
                }),
            },
        }

        // The rejection is what lets the resume block's catch discard the zombie and fall through
        // to a fresh sandbox instead of committing to it.
        await expect(__private__.probeResumedVmSandbox(sandbox)).rejects.toBe(deadline)
        expect(__private__.isUnhealthyVmSessionError(deadline)).toBe(true)
    })

    test('does not claim a sandbox leased by another active execution', async () => {
        const session = {
            status: 'busy',
            activeLeaseOwner: 'other-execution',
            activeLeaseExpiresAt: Date.now() + 60000,
        }
        const transaction = {
            get: jest.fn(async () => ({ exists: true, data: () => session })),
            set: jest.fn(),
        }
        mockFirestore.mockReturnValueOnce({
            runTransaction: jest.fn(async callback => callback(transaction)),
        })

        await expect(__private__.claimVmSessionLease({}, 'this-execution')).resolves.toEqual({
            claimed: false,
            session,
        })
        expect(transaction.set).not.toHaveBeenCalled()
    })

    test('claims an idle sandbox atomically before it is resumed', async () => {
        const session = { status: 'idle_running', sandboxId: 'sandbox-1' }
        const transaction = {
            get: jest.fn(async () => ({ exists: true, data: () => session })),
            set: jest.fn(),
        }
        mockFirestore.mockReturnValueOnce({
            runTransaction: jest.fn(async callback => callback(transaction)),
        })

        await expect(
            __private__.claimVmSessionLease({}, 'this-execution', 'correlation-1', {
                projectId: 'project-1',
                objectId: 'task-1',
                objectType: 'tasks',
            })
        ).resolves.toEqual({
            claimed: true,
            session,
        })
        expect(transaction.set).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                status: 'busy',
                lastRunStatus: null,
                projectId: 'project-1',
                objectId: 'task-1',
                objectType: 'tasks',
                activeLeaseOwner: 'this-execution',
                activeCorrelationId: 'correlation-1',
                activeLeaseExpiresAt: expect.any(Number),
            }),
            { merge: true }
        )
    })

    test('records a preserved failed run on its resumable VM session', async () => {
        const transaction = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ activeLeaseOwner: 'this-execution' }),
            })),
            set: jest.fn(),
        }
        mockFirestore.mockReturnValueOnce({
            runTransaction: jest.fn(async callback => callback(transaction)),
        })
        const sessionRef = {}
        const sandbox = {
            sandboxId: 'sandbox-1',
            setTimeout: jest.fn(async () => {}),
            kill: jest.fn(async () => {}),
        }

        await expect(
            __private__.keepVmSessionAlive(
                sessionRef,
                sandbox,
                {
                    agent: 'codex',
                    vmTemplate: 'codex-template',
                    projectId: 'project-1',
                    objectId: 'task-1',
                    objectType: 'tasks',
                },
                'test-key',
                'this-execution',
                'failed'
            )
        ).resolves.toBe(true)
        expect(transaction.set).toHaveBeenCalledWith(
            sessionRef,
            expect.objectContaining({
                status: 'idle_running',
                lastRunStatus: 'failed',
                lastRunAt: expect.any(Number),
                projectId: 'project-1',
                objectId: 'task-1',
            }),
            { merge: true }
        )
    })

    test('preserves the thread queue when both keep-alive and pause fail', async () => {
        const transaction = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    sandboxId: 'sandbox-1',
                    activeLeaseOwner: 'this-execution',
                    queue: ['queued-job'],
                    queueLength: 1,
                }),
            })),
            set: jest.fn(),
        }
        mockFirestore.mockReturnValueOnce({
            runTransaction: jest.fn(async callback => callback(transaction)),
        })
        const sessionRef = { delete: jest.fn() }
        const sandbox = {
            sandboxId: 'sandbox-1',
            setTimeout: jest.fn(async () => {
                throw new Error('sandbox disappeared')
            }),
            kill: jest.fn(async () => {}),
        }
        const originalFetch = global.fetch
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 404,
            text: async () => 'sandbox not found',
        }))

        try {
            await expect(
                __private__.keepVmSessionAlive(
                    sessionRef,
                    sandbox,
                    {
                        agent: 'claude',
                        vmTemplate: 'claude-template',
                        projectId: 'project-1',
                        objectId: 'task-1',
                        objectType: 'tasks',
                        correlationId: 'failed-job',
                    },
                    'test-key',
                    'this-execution',
                    'failed'
                )
            ).resolves.toBe(false)
        } finally {
            global.fetch = originalFetch
        }

        expect(sessionRef.delete).not.toHaveBeenCalled()
        expect(transaction.set).toHaveBeenCalledWith(
            sessionRef,
            expect.objectContaining({
                sandboxId: null,
                status: 'failed',
                activeLeaseOwner: null,
                activeCorrelationId: null,
                lastRunStatus: 'failed',
            }),
            { merge: true }
        )
    })

    test('does not clean up an old session while it still owns queued work', async () => {
        const transaction = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ lastUsedAt: 1000, queue: ['queued-job'], queueLength: 1 }),
            })),
            delete: jest.fn(),
        }
        mockFirestore.mockReturnValueOnce({
            runTransaction: jest.fn(async callback => callback(transaction)),
        })

        await expect(__private__.deleteIdleVmSessionIfUnoccupied({}, 2000, 3000)).resolves.toBeNull()
        expect(transaction.delete).not.toHaveBeenCalled()
    })
})

describe('VM runner artifact presentation', () => {
    test('places generated artifact links before the VM answer', () => {
        const finalText = __private__.buildVmFinalCommentText('Here is the summary.', [
            {
                fileName: 'report draft.pdf',
                storageUrl: 'https://storage.example/report.pdf',
            },
        ])

        expect(finalText).toBe(
            'EbDsQTD14ahtSR5https://storage.example/report.pdfEbDsQTD14ahtSR5report_draft.pdfEbDsQTD14ahtSR5false\n\nHere is the summary.'
        )
    })

    test('leaves text-only VM answers unchanged', () => {
        expect(__private__.buildVmFinalCommentText('Here is the summary.', [])).toBe('Here is the summary.')
    })
})

describe('VM completion chat metadata', () => {
    const createFirestoreMock = ({
        commentData = {},
        chatData = {},
        taskData = { commentsData: { amount: 1 } },
    } = {}) => {
        const refs = new Map()
        const doc = jest.fn(path => {
            if (!refs.has(path)) {
                refs.set(path, { path, set: jest.fn(async () => {}), update: jest.fn(async () => {}) })
            }
            return refs.get(path)
        })
        const transaction = {
            get: jest.fn(async ref => {
                if (ref.path.includes('/comments/comment-1')) {
                    return { exists: true, data: () => commentData }
                }
                if (ref.path === 'chatObjects/project-1/chats/task-1') {
                    return { exists: true, data: () => ({ title: 'Important task', members: ['user-2'], ...chatData }) }
                }
                if (ref.path === 'items/project-1/tasks/task-1') {
                    return { exists: true, data: () => taskData }
                }
                if (ref.path === 'projects/project-1') {
                    return { exists: true, data: () => ({ name: 'Product' }) }
                }
                if (ref.path === 'assistants/project-1/items/assistant-1') {
                    return { exists: true, data: () => ({ displayName: 'Anna' }) }
                }
                return { exists: false, data: () => ({}) }
            }),
            set: jest.fn(),
            update: jest.fn(),
        }
        const runTransaction = jest.fn(async callback => callback(transaction))
        mockFirestore.mockReturnValue({ doc, runTransaction })
        return { doc, runTransaction, transaction, refs }
    }

    beforeEach(() => {
        jest.clearAllMocks()
        mockFirestore.FieldValue.increment.mockImplementation(value => ({ __op: 'increment', value }))
        mockGetObjectFollowersIds.mockResolvedValue(['user-1', 'user-2'])
    })

    test('applies the same unread and task metadata as a normal assistant message', async () => {
        const { transaction, refs } = createFirestoreMock()

        const result = await __private__.applyVmCompletionMetadata(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
            },
            'comment-1',
            'Finished VM result'
        )

        expect(result.applied).toBe(true)
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('chatObjects/project-1/chats/task-1'),
            expect.objectContaining({
                members: ['user-2', 'user-1', 'assistant-1'],
                lastEditorId: 'assistant-1',
                lastAssistantComment: expect.any(Number),
                'commentsData.lastCommentOwnerId': 'assistant-1',
                'commentsData.lastComment': 'Finished VM result',
                'commentsData.lastCommentType': 2,
                'commentsData.amount': { __op: 'increment', value: 1 },
            }),
            { merge: true }
        )
        expect(transaction.update).toHaveBeenCalledWith(
            refs.get('items/project-1/tasks/task-1'),
            expect.objectContaining({
                'commentsData.lastComment': expect.any(String),
                'commentsData.lastCommentType': 2,
                'commentsData.amount': { __op: 'increment', value: 1 },
            })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('chatNotifications/project-1/user-1/comment-1'),
            expect.objectContaining({
                chatId: 'task-1',
                chatType: 'tasks',
                followed: true,
                creatorId: 'assistant-1',
                creatorType: 'assistant',
            })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('users/user-1'),
            expect.objectContaining({
                'lastAssistantCommentData.project-1': expect.objectContaining({
                    objectType: 'tasks',
                    objectId: 'task-1',
                    creatorId: 'assistant-1',
                    creatorType: 'assistant',
                }),
                'lastAssistantCommentData.allProjects': expect.objectContaining({
                    projectId: 'project-1',
                    objectId: 'task-1',
                }),
            }),
            { merge: true }
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('pushNotifications/comment-1'),
            expect.objectContaining({
                userIds: ['user-1', 'user-2'],
                chatId: 'task-1',
                projectId: 'project-1',
                type: 'Chat Notification',
            })
        )
    })

    test('activates the selected assistant after a task VM completes successfully', async () => {
        const { transaction, refs } = createFirestoreMock()

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
                statusCommentId: 'comment-1',
            },
            'Finished VM result',
            { isFinal: true, output: 'Finished VM result' }
        )

        expect(refs.get('chatComments/project-1/tasks/task-1/comments/comment-1').set).toHaveBeenCalledWith(
            expect.objectContaining({
                creatorId: 'assistant-1',
                fromAssistant: true,
                commentText: 'Finished VM result',
            }),
            { merge: true }
        )
        expect(transaction.update).toHaveBeenCalledWith(
            refs.get('items/project-1/tasks/task-1'),
            expect.objectContaining({
                assistantId: 'assistant-1',
                isAssistantEnabled: true,
            })
        )
    })

    test('restores callback routing from the immutable VM job snapshot', () => {
        expect(
            __private__.resolveVmCallbackContext(
                {
                    projectId: 'changed-project',
                    objectType: 'tasks',
                    objectId: 'changed-task',
                    assistantId: 'default-assistant',
                },
                {
                    callbackContext: {
                        projectId: 'origin-project',
                        objectType: 'tasks',
                        objectId: 'origin-task',
                        assistantId: 'origin-assistant',
                    },
                }
            )
        ).toMatchObject({
            projectId: 'origin-project',
            objectType: 'tasks',
            objectId: 'origin-task',
            assistantId: 'origin-assistant',
        })
    })

    test('recovers legacy callback routing from VM job top-level fields without guessing missing assistants', () => {
        expect(
            __private__.resolveVmCallbackContext(
                { correlationId: 'legacy-correlation' },
                {
                    projectId: 'legacy-project',
                    objectId: 'legacy-task',
                    assistantId: 'legacy-assistant',
                }
            )
        ).toMatchObject({
            projectId: 'legacy-project',
            objectType: 'tasks',
            objectId: 'legacy-task',
            assistantId: 'legacy-assistant',
        })

        expect(
            __private__.resolveVmCallbackContext(
                { correlationId: 'incomplete-correlation' },
                { projectId: 'legacy-project', objectId: 'legacy-task' }
            )
        ).not.toHaveProperty('assistantId')
    })

    test('finalizes an existing legacy status comment without guessing a missing assistant', async () => {
        const { refs, transaction } = createFirestoreMock()

        await __private__.writeStatusComment(
            {
                correlationId: 'incomplete-correlation',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                userId: 'user-1',
                statusCommentId: 'comment-1',
            },
            'Finished legacy VM result',
            { isFinal: true, output: 'Finished legacy VM result' }
        )

        expect(refs.get('chatComments/project-1/tasks/task-1/comments/comment-1').set).toHaveBeenCalledWith(
            expect.not.objectContaining({ creatorId: expect.anything() }),
            { merge: true }
        )
        expect(transaction.set).not.toHaveBeenCalled()
        expect(transaction.update).not.toHaveBeenCalled()
    })

    test('does not double-apply metadata when the VM finalizer is retried', async () => {
        const { transaction } = createFirestoreMock({
            commentData: { vmCompletionMetadataAppliedAt: 123 },
        })

        const result = await __private__.applyVmCompletionMetadata(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
            },
            'comment-1',
            'Finished VM result'
        )

        expect(result).toEqual({ applied: false, reason: 'already-applied' })
        expect(transaction.set).not.toHaveBeenCalled()
        expect(transaction.update).not.toHaveBeenCalled()
    })

    test('updates task-list comment metadata when a VM run fails', async () => {
        const { transaction, refs } = createFirestoreMock()
        const failureText = '❌ The VM task could not be completed: exit status 1'

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
                statusCommentId: 'comment-1',
            },
            failureText,
            { assistantRunStatus: 'failed' }
        )

        expect(refs.get('chatComments/project-1/tasks/task-1/comments/comment-1').set).toHaveBeenCalledWith(
            expect.objectContaining({
                commentText: failureText,
                isLoading: false,
                assistantRun: expect.objectContaining({ status: 'failed' }),
            }),
            { merge: true }
        )
        expect(transaction.update).toHaveBeenCalledWith(
            refs.get('items/project-1/tasks/task-1'),
            expect.objectContaining({
                'commentsData.lastComment': expect.stringContaining('The VM task could not b'),
                'commentsData.lastCommentType': 2,
                'commentsData.amount': { __op: 'increment', value: 1 },
            })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('chatObjects/project-1/chats/task-1'),
            expect.objectContaining({
                'commentsData.lastComment': failureText,
                'commentsData.amount': { __op: 'increment', value: 1 },
            }),
            { merge: true }
        )
        expect(transaction.update).toHaveBeenCalledWith(
            refs.get('items/project-1/tasks/task-1'),
            expect.not.objectContaining({
                isAssistantEnabled: true,
            })
        )
    })

    test('does not activate the task assistant when a VM run is cancelled', async () => {
        const { transaction, refs } = createFirestoreMock()

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
                statusCommentId: 'comment-1',
            },
            'VM task stopped.',
            { assistantRunStatus: 'cancelled' }
        )

        expect(transaction.update).toHaveBeenCalledWith(
            refs.get('items/project-1/tasks/task-1'),
            expect.not.objectContaining({
                isAssistantEnabled: true,
            })
        )
    })

    // AT-2196: a run that ends without doing the work must land back on a human. The workflow step
    // is deliberately untouched — only the reviewer moves, exactly like an agent question.
    describe('failure hands the task to the requesting user (AT-2196)', () => {
        const workflowTask = {
            commentsData: { amount: 1 },
            currentReviewerId: 'assistant-1',
            stepHistory: [-1, 'ai-step'],
            userIds: ['user-1', 'assistant-1'],
        }
        const pendingWebhook = {
            correlationId: 'correlation-1',
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            userIdsToNotify: ['user-1'],
            isPublicFor: [0],
            statusCommentId: 'comment-1',
        }
        const taskUpdate = (transaction, refs) =>
            transaction.update.mock.calls.find(call => call[0] === refs.get('items/project-1/tasks/task-1'))?.[1]

        test('assigns the failed task to the user while preserving its workflow step', async () => {
            const { transaction, refs } = createFirestoreMock({ taskData: workflowTask })

            await __private__.writeStatusComment(pendingWebhook, '❌ The VM task could not be completed: boom', {
                assistantRunStatus: 'failed',
                failureReason: 'runtime_timeout',
            })

            const update = taskUpdate(transaction, refs)
            expect(update).toMatchObject({
                currentReviewerId: 'user-1',
                vmInteractionWorkflowStep: expect.objectContaining({
                    reason: 'failure',
                    failureReason: 'runtime_timeout',
                    reviewerId: 'user-1',
                    previousReviewerId: 'assistant-1',
                    workflowStepId: 'ai-step',
                }),
            })
            // The step itself never moves: no stepHistory rewrite, no done/completed flags.
            expect(update).toEqual(expect.not.objectContaining({ stepHistory: expect.anything() }))
            expect(update).toEqual(expect.not.objectContaining({ done: expect.anything() }))
            expect(update).toEqual(expect.not.objectContaining({ inDone: expect.anything() }))
            expect(update).toEqual(expect.not.objectContaining({ completed: expect.anything() }))
        })

        test('also assigns a cancelled run back to the user', async () => {
            const { transaction, refs } = createFirestoreMock({ taskData: workflowTask })

            await __private__.writeStatusComment(pendingWebhook, 'Stopped.', { assistantRunStatus: 'cancelled' })

            expect(taskUpdate(transaction, refs)).toMatchObject({
                currentReviewerId: 'user-1',
                vmInteractionWorkflowStep: expect.objectContaining({ reason: 'failure', failureReason: 'cancelled' }),
            })
        })

        test('leaves the reviewer alone when the run succeeds', async () => {
            const { transaction, refs } = createFirestoreMock({ taskData: workflowTask })

            await __private__.writeStatusComment(pendingWebhook, 'All done.', { isFinal: true, output: 'All done.' })

            const update = taskUpdate(transaction, refs)
            expect(update).toMatchObject({ isAssistantEnabled: true })
            expect(update).toEqual(expect.not.objectContaining({ currentReviewerId: expect.anything() }))
            expect(update).toEqual(expect.not.objectContaining({ vmInteractionWorkflowStep: expect.anything() }))
        })

        test('leaves the reviewer alone while a run is still in progress', async () => {
            const { transaction, refs } = createFirestoreMock({ taskData: workflowTask })

            await __private__.writeStatusComment(pendingWebhook, '⏳ Working…', { assistantRunStatus: 'running' })

            expect(taskUpdate(transaction, refs)).toBeUndefined()
        })

        test('does not touch the reviewer of a non-task thread', async () => {
            const { transaction, refs } = createFirestoreMock({ taskData: workflowTask })

            await __private__.writeStatusComment(
                { ...pendingWebhook, objectType: 'topics' },
                '❌ The VM task could not be completed: boom',
                { assistantRunStatus: 'failed' }
            )

            expect(
                transaction.update.mock.calls.every(call => !call[1] || call[1].currentReviewerId === undefined)
            ).toBe(true)
            expect(refs.has('items/project-1/tasks/task-1')).toBe(false)
        })

        test('leaves a task alone when a human took it over while the VM was running', async () => {
            const { transaction, refs } = createFirestoreMock({
                taskData: { ...workflowTask, currentReviewerId: 'bob' },
            })

            await __private__.writeStatusComment(pendingWebhook, '❌ The VM task could not be completed: boom', {
                assistantRunStatus: 'failed',
            })

            const update = taskUpdate(transaction, refs)
            expect(update).toEqual(expect.not.objectContaining({ currentReviewerId: expect.anything() }))
        })

        test('still hands the task over when the comment metadata was already applied', async () => {
            // A run can post its final answer and then throw while billing. It settles as failed, and
            // that failure has to reach a human even though the one-shot metadata guard has fired.
            const { transaction, refs } = createFirestoreMock({
                taskData: workflowTask,
                commentData: { vmCompletionMetadataAppliedAt: 123 },
            })

            await __private__.writeStatusComment(pendingWebhook, '❌ The VM task could not be completed: boom', {
                assistantRunStatus: 'failed',
            })

            expect(taskUpdate(transaction, refs)).toEqual({
                currentReviewerId: 'user-1',
                vmInteractionWorkflowStep: expect.objectContaining({ reason: 'failure' }),
            })
        })

        test('does not steal a task another VM job is holding', async () => {
            const { transaction, refs } = createFirestoreMock({
                taskData: {
                    ...workflowTask,
                    currentReviewerId: 'user-2',
                    vmInteractionWorkflowStep: {
                        correlationId: 'other-run',
                        requestId: 'request-9',
                        reviewerId: 'user-2',
                        previousReviewerId: 'assistant-1',
                        reason: 'interaction',
                    },
                },
            })

            await __private__.writeStatusComment(pendingWebhook, '❌ The VM task could not be completed: boom', {
                assistantRunStatus: 'failed',
            })

            const update = taskUpdate(transaction, refs)
            expect(update).toEqual(expect.not.objectContaining({ currentReviewerId: expect.anything() }))
            expect(update).toEqual(expect.not.objectContaining({ vmInteractionWorkflowStep: expect.anything() }))
        })
    })

    test('does not change assistant activation for a successful topic VM run', async () => {
        const { transaction, refs } = createFirestoreMock()

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
                statusCommentId: 'comment-1',
            },
            'Finished VM result',
            { isFinal: true, output: 'Finished VM result' }
        )

        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('chatObjects/project-1/chats/task-1'),
            expect.not.objectContaining({
                isAssistantEnabled: true,
            }),
            { merge: true }
        )
        expect(transaction.update).not.toHaveBeenCalled()
    })

    test('keeps task-list and chat previews in sync with live VM progress without incrementing counts', async () => {
        const { refs, transaction } = createFirestoreMock()
        const progressText = '⏳ Reading the task-list listeners'

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                statusCommentId: 'comment-1',
            },
            progressText
        )

        expect(refs.get('chatObjects/project-1/chats/task-1').update).toHaveBeenCalledWith(
            expect.objectContaining({
                lastEditorId: 'assistant-1',
                'commentsData.lastCommentOwnerId': 'assistant-1',
                'commentsData.lastComment': progressText,
                'commentsData.lastCommentType': 2,
            })
        )
        expect(refs.get('items/project-1/tasks/task-1').update).toHaveBeenCalledWith({
            'commentsData.lastComment': expect.stringContaining('Reading the task-list'),
            'commentsData.lastCommentType': 2,
        })
        expect(refs.get('chatObjects/project-1/chats/task-1').update.mock.calls[0][0]).not.toHaveProperty(
            'commentsData.amount'
        )
        expect(refs.get('items/project-1/tasks/task-1').update.mock.calls[0][0]).not.toHaveProperty(
            'commentsData.amount'
        )
        expect(transaction.set).not.toHaveBeenCalled()
        expect(transaction.update).not.toHaveBeenCalled()
    })

    // The live thinking/working log is rewritten into the same comment many times per run. None of
    // those rewrites may create an unread marker: the red badge has to mean "there is something to
    // read", not "the VM is still typing". Settled runs — including the unsuccessful ones — and
    // questions the VM asks (written by vmInteraction, not here) are the only red-worthy events.
    const chatNotificationWrites = transaction =>
        transaction.set.mock.calls
            .map(([ref]) => (ref && ref.path) || '')
            .filter(path => path.startsWith('chatNotifications/'))

    test.each([
        ['a live progress update', {}],
        ['a run waiting for the user to answer', { assistantRunStatus: 'awaiting_user' }],
        ['a run whose cancellation was requested', { assistantRunStatus: 'cancel_requested' }],
    ])('writes no unread notification for %s', async (_label, options) => {
        const { transaction } = createFirestoreMock()

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
                statusCommentId: 'comment-1',
            },
            '🖥️ Working with Claude in a VM…\n\n💻 npm test',
            options
        )

        expect(chatNotificationWrites(transaction)).toEqual([])
        expect(transaction.set).not.toHaveBeenCalled()
    })

    test.each([
        ['the final result', { isFinal: true, output: 'Finished VM result' }],
        ['a failed run', { assistantRunStatus: 'failed' }],
        ['a cancelled run', { assistantRunStatus: 'cancelled' }],
    ])('writes the unread notification for %s', async (_label, options) => {
        const { transaction } = createFirestoreMock()

        await __private__.writeStatusComment(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
                statusCommentId: 'comment-1',
            },
            'Settled VM run',
            options
        )

        expect(chatNotificationWrites(transaction)).toEqual(['chatNotifications/project-1/user-1/comment-1'])
        expect(transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'chatNotifications/project-1/user-1/comment-1' }),
            // followed: true is what makes the badge red rather than grey.
            expect.objectContaining({ followed: true, creatorType: 'assistant' })
        )
    })

    test('does not treat the assistant as a user when it appears in the follower list', async () => {
        mockGetObjectFollowersIds.mockResolvedValue(['assistant-1', 'user-1', 'user-2'])
        const { transaction, refs } = createFirestoreMock()

        const result = await __private__.applyVmCompletionMetadata(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
            },
            'comment-1',
            'Finished VM result'
        )

        expect(result.followerIds).toEqual(['user-1', 'user-2'])
        expect(transaction.set).not.toHaveBeenCalledWith(
            refs.get('users/assistant-1'),
            expect.anything(),
            expect.anything()
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('emailNotifications/task-1'),
            expect.objectContaining({ userIds: ['user-1', 'user-2'] }),
            { merge: true }
        )
    })
})

describe('VM runner WhatsApp notifications', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValue({
            success: true,
            sid: 'SM123',
            status: 'queued',
        })
    })

    test('sends final output for WhatsApp-originated VM jobs', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            'Final VM result',
            {
                mediaContext: [{ fileName: 'report.pdf', storageUrl: 'https://storage.example/report.pdf' }],
                pendingRef,
            }
        )

        expect(result.success).toBe(true)
        expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalledWith(
            'whatsapp:+123',
            'Generated file:\nreport.pdf: https://storage.example/report.pdf\n\nFinal VM result',
            {
                projectId: 'project-1',
                objectId: 'chat-1',
                objectType: 'topics',
            }
        )
        expect(pendingRef.update).toHaveBeenCalledWith(
            expect.objectContaining({
                whatsappNotification: expect.objectContaining({
                    type: 'completed',
                    success: true,
                    sid: 'SM123',
                }),
            })
        )
    })

    test('does not send for app-originated VM jobs', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            'Final VM result',
            { pendingRef }
        )

        expect(result).toBeNull()
        expect(mockSendWhatsAppMessageWithConversationLink).not.toHaveBeenCalled()
        expect(pendingRef.update).not.toHaveBeenCalled()
    })

    test('sends the public artifact link, not the internal chat attachment token', () => {
        const finalTextWithToken =
            'Final VM result \n\n EbDsQTD14ahtSR5https://storage.example/fileEbDsQTD14ahtSR5file.pdfEbDsQTD14ahtSR5false'
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage('Final VM result', {
            mediaContext: [{ fileName: 'file.pdf', storageUrl: 'https://storage.example/file.pdf' }],
        })

        expect(finalTextWithToken).toContain('EbDsQTD14ahtSR5')
        expect(whatsappMessage).toBe('Generated file:\nfile.pdf: https://storage.example/file.pdf\n\nFinal VM result')
        expect(whatsappMessage).not.toContain('EbDsQTD14ahtSR5')
    })

    test('lists every artifact download link before the answer', () => {
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage('Done', {
            mediaContext: [
                { fileName: 'a.pdf', storageUrl: 'https://storage.example/a' },
                { fileName: 'b.csv', storageUrl: 'https://storage.example/b' },
            ],
        })

        expect(whatsappMessage).toBe(
            'Generated files:\na.pdf: https://storage.example/a\nb.csv: https://storage.example/b\n\nDone'
        )
    })

    test('leads with the artifact link so it survives WhatsApp tail truncation', () => {
        const longAnswer = 'x'.repeat(2000)
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage(longAnswer, {
            mediaContext: [{ fileName: 'big.pdf', storageUrl: 'https://storage.example/big.pdf' }],
        })

        // Link is at the very top; the service trims the answer tail (never the leading link).
        expect(whatsappMessage.startsWith('Generated file:\nbig.pdf: https://storage.example/big.pdf')).toBe(true)
    })

    test('falls back to the plain answer when there are no artifacts', () => {
        expect(__private__.buildWhatsAppVmResultMessage('Just a text answer', {})).toBe('Just a text answer')
        expect(__private__.buildWhatsAppVmResultMessage('Just a text answer', { mediaContext: [] })).toBe(
            'Just a text answer'
        )
    })

    test('sends failure text for WhatsApp-originated VM jobs', async () => {
        await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            '❌ The VM task could not be completed: timeout',
            { notificationType: 'failed' }
        )

        expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalledWith(
            'whatsapp:+123',
            '❌ The VM task could not be completed: timeout',
            expect.any(Object)
        )
    })

    test('records Twilio failure without throwing', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValueOnce({
            success: false,
            error: 'Twilio rejected the message',
        })

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            'Final VM result',
            { pendingRef }
        )

        expect(result.success).toBe(false)
        expect(result.error).toBe('Twilio rejected the message')
        expect(pendingRef.update).toHaveBeenCalledWith(
            expect.objectContaining({
                whatsappNotification: expect.objectContaining({
                    success: false,
                    error: 'Twilio rejected the message',
                }),
            })
        )
    })
})

describe('VM runner origin-conversation completion note', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockCreateInitialStatusMessage.mockResolvedValue('origin-comment-1')
    })

    test('posts a completion note into the delegated-from conversation', async () => {
        const result = await __private__.postVmOriginConversationNote(
            {
                correlationId: 'correlation-1',
                userId: 'user-1',
                projectId: 'project-X',
                objectType: 'tasks',
                objectId: 'host-task-1',
                originProjectId: 'project-anna',
                originObjectType: 'topics',
                originObjectId: 'whatsapp-topic-1',
                originAssistantId: 'anna-assistant',
            },
            'The competitor research is done.',
            { notificationType: 'completed' }
        )

        expect(result).toBe(true)
        expect(mockCreateInitialStatusMessage).toHaveBeenCalledTimes(1)
        const [projectId, objectType, objectId, assistantId, note, userIdsToNotify, , followerIds] =
            mockCreateInitialStatusMessage.mock.calls[0]
        expect(projectId).toBe('project-anna')
        expect(objectType).toBe('topics')
        expect(objectId).toBe('whatsapp-topic-1')
        expect(assistantId).toBe('anna-assistant')
        expect(userIdsToNotify).toEqual(['user-1'])
        expect(followerIds).toEqual(['user-1'])
        // Note carries the outcome + a deep link to the host task (a different object/project).
        expect(note).toContain('✅')
        expect(note).toContain('finished')
        expect(note).toContain('The competitor research is done.')
        expect(note).toContain('host-task-1')
    })

    test('uses the failure framing for failed jobs', async () => {
        await __private__.postVmOriginConversationNote(
            {
                userId: 'user-1',
                projectId: 'project-X',
                objectId: 'host-task-1',
                originProjectId: 'project-anna',
                originObjectId: 'whatsapp-topic-1',
                originAssistantId: 'anna-assistant',
            },
            '❌ It broke.',
            { notificationType: 'failed' }
        )

        const note = mockCreateInitialStatusMessage.mock.calls[0][4]
        expect(note).toContain('failed')
        expect(note).not.toContain('✅')
    })

    test('is a no-op when there is no origin conversation', async () => {
        const result = await __private__.postVmOriginConversationNote(
            { userId: 'user-1', projectId: 'project-X', objectId: 'host-task-1' },
            'done',
            {}
        )
        expect(result).toBeNull()
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    test('is a no-op when the origin conversation is the host thread itself', async () => {
        const result = await __private__.postVmOriginConversationNote(
            {
                userId: 'user-1',
                projectId: 'project-X',
                objectId: 'host-task-1',
                originProjectId: 'project-X',
                originObjectId: 'host-task-1',
                originAssistantId: 'cto-assistant',
            },
            'done',
            {}
        )
        expect(result).toBeNull()
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
    })

    // AT-2387: the result lands in the host task thread, but a WhatsApp follow-up is
    // answered out of the daily WhatsApp topic — mirror it there too.
    test('mirrors the delivered result into the daily WhatsApp topic', async () => {
        await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                userId: 'user-1',
                assistantId: 'assistant-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'host-task-1',
            },
            'Final VM result',
            { notificationType: 'completed' }
        )

        expect(mockMirrorAssistantResultToWhatsAppDailyTopic).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                assistantId: 'assistant-1',
                // The exact text that went out over WhatsApp, artifact links included.
                resultText: 'Final VM result',
                sourceProjectId: 'project-1',
                sourceObjectId: 'host-task-1',
                sourceObjectType: 'tasks',
                sourceLabel: 'From your VM task',
                // Stable across runner retries and the reconciliation pass.
                sourceCommentId: 'vmJob:correlation-1:completed',
            })
        )
    })

    test('does not mirror when the WhatsApp send failed', async () => {
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValueOnce({ success: false, error: 'twilio down' })

        await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                userId: 'user-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'host-task-1',
            },
            'Final VM result',
            {}
        )

        expect(mockMirrorAssistantResultToWhatsAppDailyTopic).not.toHaveBeenCalled()
    })

    test('lets the mirror stand down where the origin note already posts the outcome', async () => {
        await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                userId: 'user-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-X',
                objectType: 'tasks',
                objectId: 'host-task-1',
                originProjectId: 'project-anna',
                originObjectType: 'topics',
                originObjectId: 'BotChat20260820user-1',
                originAssistantId: 'anna-assistant',
            },
            'All done.',
            { notificationType: 'completed' }
        )

        expect(mockMirrorAssistantResultToWhatsAppDailyTopic).toHaveBeenCalledWith(
            expect.objectContaining({
                alreadyDeliveredTo: [{ projectId: 'project-anna', objectId: 'BotChat20260820user-1' }],
            })
        )
    })

    test('a failing mirror never fails the notification that already went out', async () => {
        mockMirrorAssistantResultToWhatsAppDailyTopic.mockRejectedValueOnce(new Error('firestore down'))

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                userId: 'user-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'host-task-1',
            },
            'Final VM result',
            {}
        )

        expect(result.success).toBe(true)
    })

    test('notifyVmResultChannels fans out to both WhatsApp and the origin note', async () => {
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValue({ success: true, sid: 'SM1', status: 'queued' })

        await __private__.notifyVmResultChannels(
            {
                correlationId: 'correlation-1',
                userId: 'user-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-X',
                objectType: 'tasks',
                objectId: 'host-task-1',
                originProjectId: 'project-anna',
                originObjectType: 'topics',
                originObjectId: 'whatsapp-topic-1',
                originAssistantId: 'anna-assistant',
            },
            'All done.',
            { notificationType: 'completed' }
        )

        expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalledTimes(1)
        expect(mockCreateInitialStatusMessage).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------
// OpenRouter routing for the Codex harness (AT-2230)
// ---------------------------------------------------------------------------

describe('Codex OpenRouter routing', () => {
    const PROXY = 'https://proxy.example/vmLlmProxy'

    test('points Codex at the OpenRouter proxy route with the Responses wire API', () => {
        const overrides = __private__.buildCodexProxyConfigOverrides(PROXY, { openRouter: true })

        expect(overrides).toContain(
            `model_providers.alldone_vm_proxy.base_url="https://proxy.example/vmLlmProxy/openrouter/v1"`
        )
        // The Codex CLI removed `wire_api = "chat"` in Feb 2026 (a current CLI exits 13 on it at
        // config load), and OpenRouter's Responses API is GA — so this route speaks `responses`
        // like the OpenAI one. See buildCodexProxyConfigOverrides.
        expect(overrides).toContain(`model_providers.alldone_vm_proxy.wire_api="responses"`)
        expect(overrides).not.toContain(`model_providers.alldone_vm_proxy.wire_api="chat"`)
        expect(overrides).toContain('model_providers.alldone_vm_proxy.supports_websockets=false')
    })

    test('leaves the OpenAI route exactly as it was', () => {
        const overrides = __private__.buildCodexProxyConfigOverrides(PROXY)

        expect(overrides).toContain(
            `model_providers.alldone_vm_proxy.base_url="https://proxy.example/vmLlmProxy/openai/v1"`
        )
        expect(overrides).toContain(`model_providers.alldone_vm_proxy.wire_api="responses"`)
    })

    // The `openrouter:` prefix is Alldone's routing marker. Handing it to the CLI would make Codex
    // ask OpenRouter for a model called "openrouter:deepseek/deepseek-chat", which does not exist.
    test('strips the routing marker before the model reaches the CLI, and quotes the id', () => {
        const command = __private__.buildCodexRunCommand(false, 'openrouter:deepseek/deepseek-chat', 'medium', PROXY)

        expect(command).toContain(`--model 'deepseek/deepseek-chat'`)
        expect(command).not.toContain('openrouter:deepseek')
        expect(command).toContain('/openrouter/v1')
        expect(command).toContain(`model_providers.alldone_vm_proxy.wire_api="responses"`)
    })

    test('an OpenAI model still routes to the OpenAI upstream', () => {
        const command = __private__.buildCodexRunCommand(false, 'gpt-5.6-sol', 'medium', PROXY)

        expect(command).toContain(`--model 'gpt-5.6-sol'`)
        expect(command).toContain('/openai/v1')
        expect(command).not.toContain('/openrouter/v1')
    })

    test('the sandbox env base URL follows the same route as the provider config', () => {
        const openRouterEnv = __private__.AGENT_CONFIGS.codex.sandboxEnv({
            apiKey: 'vmpx_token',
            baseUrl: PROXY,
            mode: 'proxy',
            agentModel: 'openrouter:deepseek/deepseek-chat',
        })
        const openAiEnv = __private__.AGENT_CONFIGS.codex.sandboxEnv({
            apiKey: 'vmpx_token',
            baseUrl: PROXY,
            mode: 'proxy',
            agentModel: 'gpt-5.6-sol',
        })

        expect(openRouterEnv.OPENAI_BASE_URL).toBe('https://proxy.example/vmLlmProxy/openrouter/v1')
        expect(openAiEnv.OPENAI_BASE_URL).toBe('https://proxy.example/vmLlmProxy/openai/v1')
        // The real OpenRouter key never reaches the sandbox — only the per-job proxy token.
        expect(openRouterEnv.OPENAI_API_KEY).toBe('vmpx_token')
    })
})
