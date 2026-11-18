'use strict'

// Runs the real Claude bridge (vm-agent-bridge/claude-agent-sdk.mjs) the way the runner does in
// the sandbox: copied into a directory next to approval-policy.cjs, with the SDK resolved from that
// directory's node_modules. A stub SDK records the options it receives and plays one of the
// scenarios below. Like the real SDK (checked against 0.3.327), a permission check fails with
// "Stream closed" once the CLI's input is closed, and a streamed prompt ends the query only when
// the bridge closes its input.

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { __private__ } = require('./vmJobRunner')

const STUB_SDK = `
import fs from 'node:fs'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const assistant = text => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } })
const result = text => ({ type: 'result', subtype: 'success', result: text, session_id: 'session-1' })
const init = { type: 'system', subtype: 'init', session_id: 'session-1' }
const tasks = list => ({ type: 'system', subtype: 'background_tasks_changed', tasks: list, session_id: 'session-1' })

export async function* query({ prompt, options }) {
    const { canUseTool, ...recorded } = options
    const log = []
    let firstMessage = prompt
    // A string prompt is one turn: the real SDK closes the CLI's input at the first result.
    let inputClosed = false
    if (typeof prompt !== 'string') {
        const iterator = prompt[Symbol.asyncIterator]()
        firstMessage = (await iterator.next()).value
        iterator.next().then(() => {
            inputClosed = true
            log.push('input closed')
        })
    }
    const endOfTurn = text => {
        if (typeof prompt === 'string') inputClosed = true
        return result(text)
    }
    const askPermission = async (toolName, toolInput) => {
        if (inputClosed) {
            log.push('Tool permission request failed: AbortError: Stream closed')
            return
        }
        const decision = await canUseTool(toolName, toolInput)
        log.push(toolName + ': ' + decision.behavior)
    }

    try {
        const scenario = process.env.STUB_SDK_SCENARIO || 'one_turn'
        yield init
        if (scenario === 'one_turn') {
            yield assistant('Merged and deployed.')
            yield endOfTurn('Merged and deployed.')
        } else if (scenario === 'background_turn') {
            // The run on AT-3093: the agent answers while its test suite runs in the background,
            // and the suite's completion starts the turn that pushes.
            yield assistant('Started the full test suite in the background.')
            yield tasks([{ task_id: 'tests', task_type: 'local_bash', description: 'Full test suite' }])
            yield endOfTurn('Started the full test suite in the background.')
            await sleep(300)
            log.push(inputClosed ? 'input closed while the suite ran' : 'input open while the suite ran')
            yield { type: 'system', subtype: 'task_notification', task_id: 'tests', status: 'completed', session_id: 'session-1' }
            yield tasks([])
            yield init
            await askPermission('Bash', { command: 'git push -u origin HEAD -o merge_request.create' })
            yield assistant('Pushed the branch.')
            yield endOfTurn('Pushed the branch.')
        } else if (scenario === 'task_never_reports') {
            yield assistant('Started the dev server.')
            yield tasks([{ task_id: 'server', task_type: 'local_bash', description: 'npm run dev' }])
            yield endOfTurn('Started the dev server.')
        }
        // With open input the CLI waits for the next message and exits only when the input closes.
        for (let waited = 0; !inputClosed && waited < 3000; waited += 10) await sleep(10)
    } finally {
        fs.writeFileSync(process.env.STUB_SDK_OPTIONS, JSON.stringify({ prompt: firstMessage, options: recorded, log }))
    }
}
`

describe('Claude agent bridge', () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-agent-bridge-'))
        fs.copyFileSync(
            path.join(__dirname, 'vm-agent-bridge', 'claude-agent-sdk.mjs'),
            path.join(dir, 'claude-agent-sdk.mjs')
        )
        fs.copyFileSync(path.join(__dirname, 'vmAgentApprovalPolicy.js'), path.join(dir, 'approval-policy.cjs'))
        const sdkDir = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
        fs.mkdirSync(sdkDir, { recursive: true })
        fs.writeFileSync(
            path.join(sdkDir, 'package.json'),
            JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk', type: 'module', main: 'index.js' })
        )
        fs.writeFileSync(path.join(sdkDir, 'index.js'), STUB_SDK)
    })

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    const runBridge = (input, scenario = 'one_turn') => {
        const inputPath = path.join(dir, 'input.json')
        const optionsPath = path.join(dir, 'options.json')
        fs.writeFileSync(inputPath, JSON.stringify(input))
        const stdout = execFileSync(process.execPath, [path.join(dir, 'claude-agent-sdk.mjs'), inputPath], {
            env: { PATH: process.env.PATH, STUB_SDK_OPTIONS: optionsPath, STUB_SDK_SCENARIO: scenario },
            encoding: 'utf8',
            timeout: 10000,
        })
        return {
            events: stdout
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line)),
            received: JSON.parse(fs.readFileSync(optionsPath, 'utf8')),
        }
    }

    // A short settle time keeps the suite fast; the runner leaves both values at their defaults.
    const bridgeInput = (executionMode, overrides = {}, pendingWebhook = {}) => ({
        ...__private__.buildVmAgentBridgeInput({
            vmJob: { agent: 'claude', executionMode },
            pendingWebhook,
            workdir: dir,
            prompt: 'Merge MR !874 and confirm the deployment',
            runDetails: { model: 'opus', effort: 'high' },
            agentCredentials: { mode: 'subscription' },
        }),
        inputSettleMs: 20,
        ...overrides,
    })

    test.each(['interactive', 'plan_first'])('hands the scheduling-tool block to the SDK (%s)', executionMode => {
        const { received } = runBridge(bridgeInput(executionMode))

        expect(received.options.disallowedTools).toEqual(__private__.VM_CLAUDE_DISALLOWED_TOOLS)
        expect(received.options.disallowedTools).toContain('ScheduleWakeup')
    })

    test('reports the run as completed as soon as the query ends', () => {
        const { events } = runBridge(bridgeInput('interactive'))

        expect(events[events.length - 1]).toEqual({
            type: 'alldone.completed',
            output: 'Merged and deployed.',
            usage: null,
            providerState: { sessionId: 'session-1' },
        })
    })

    test('leaves the SDK tool list alone when the runner sends no block list', () => {
        const { received } = runBridge({
            cwd: dir,
            prompt: 'Hello',
            phase: 'executing',
            permissionMode: 'default',
            inputSettleMs: 20,
        })

        expect(received.options).not.toHaveProperty('disallowedTools')
    })

    test('streams the prompt of a gated run as the message the SDK would send for it', () => {
        const { received } = runBridge(bridgeInput('interactive'))

        expect(received.prompt).toEqual({
            type: 'user',
            session_id: '',
            message: { role: 'user', content: [{ type: 'text', text: 'Merge MR !874 and confirm the deployment' }] },
            parent_tool_use_id: null,
        })
        expect(received.log).toEqual(['input closed'])
    })

    test('keeps a string prompt where nothing travels back to the CLI', () => {
        // A plan_first run executes its approved plan without permission checks.
        const input = bridgeInput(
            'plan_first',
            {},
            { answeredInteraction: { kind: 'plan_review' }, interactionResponse: { action: 'approve' } }
        )
        expect(input.permissionMode).toBe('bypassPermissions')

        const { received } = runBridge(input)

        expect(received.prompt).toBe(input.prompt)
    })

    // AT-3093: the run finished its change, then failed to push it five times with "Stream closed".
    test('still answers permission checks in a turn that a finished background task starts', () => {
        // The policy approves the push from a feature branch, as on AT-3093.
        fs.mkdirSync(path.join(dir, '.git'))
        fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/ai/project-assistant-picker\n')

        const { events, received } = runBridge(bridgeInput('interactive'), 'background_turn')

        expect(received.log).toEqual(['input open while the suite ran', 'Bash: allow', 'input closed'])
        expect(events[events.length - 1]).toMatchObject({ type: 'alldone.completed', output: 'Pushed the branch.' })
    })

    test('closes the input after the idle cap when a task never reports its end', () => {
        // Without the cap the stub would give up waiting after 3 s with nothing in its log.
        const { events, received } = runBridge(
            bridgeInput('interactive', { inputIdleCapMs: 200 }),
            'task_never_reports'
        )

        expect(received.log).toEqual(['input closed'])
        expect(events[events.length - 1]).toMatchObject({
            type: 'alldone.completed',
            output: 'Started the dev server.',
        })
    })
})
