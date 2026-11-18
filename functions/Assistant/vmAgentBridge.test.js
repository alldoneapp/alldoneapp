'use strict'

// Runs the real Claude bridge (vm-agent-bridge/claude-agent-sdk.mjs) the way the runner does in
// the sandbox: copied into a directory next to approval-policy.cjs, with the SDK resolved from that
// directory's node_modules. A stub SDK records the options it receives.

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { __private__ } = require('./vmJobRunner')

const STUB_SDK = `
import fs from 'node:fs'
export async function* query({ prompt, options }) {
    const { canUseTool, ...recorded } = options
    fs.writeFileSync(process.env.STUB_SDK_OPTIONS, JSON.stringify({ prompt, options: recorded }))
    yield { type: 'system', subtype: 'init', session_id: 'session-1' }
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Merged and deployed.' }] } }
    yield { type: 'result', subtype: 'success', result: 'Merged and deployed.', session_id: 'session-1' }
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

    const runBridge = input => {
        const inputPath = path.join(dir, 'input.json')
        const optionsPath = path.join(dir, 'options.json')
        fs.writeFileSync(inputPath, JSON.stringify(input))
        const stdout = execFileSync(process.execPath, [path.join(dir, 'claude-agent-sdk.mjs'), inputPath], {
            env: { PATH: process.env.PATH, STUB_SDK_OPTIONS: optionsPath },
            encoding: 'utf8',
        })
        return {
            events: stdout
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line)),
            received: JSON.parse(fs.readFileSync(optionsPath, 'utf8')),
        }
    }

    const bridgeInput = executionMode =>
        __private__.buildVmAgentBridgeInput({
            vmJob: { agent: 'claude', executionMode },
            pendingWebhook: {},
            workdir: dir,
            prompt: 'Merge MR !874 and confirm the deployment',
            runDetails: { model: 'opus', effort: 'high' },
            agentCredentials: { mode: 'subscription' },
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
        const { received } = runBridge({ cwd: dir, prompt: 'Hello', phase: 'executing', permissionMode: 'default' })

        expect(received.options).not.toHaveProperty('disallowedTools')
    })
})
