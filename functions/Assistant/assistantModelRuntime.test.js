/** @jest-environment node */
// assistantModelRuntime.js exists so that code which only needs a model client, a model id or
// a Gold rate does not import assistantHelper.js. That file sits in an import cycle of 30
// modules; every function that reaches it loads the whole assistant and is redeployed on any
// change to it (89 functions in 2026-11, 70 once these helpers moved out).
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO_ROOT = path.join(__dirname, '..', '..')
const RUNTIME = 'functions/Assistant/assistantModelRuntime.js'
const HELPER = 'functions/Assistant/assistantHelper.js'
const read = file => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')
const localRequires = file =>
    [...read(file).matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map(match => {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]))
        return fs.existsSync(path.join(REPO_ROOT, target)) ? target : `${target}.js`
    })

describe('assistantModelRuntime stays out of the assistant core', () => {
    it('requires only modules that require nothing local themselves', () => {
        const required = localRequires(RUNTIME)
        expect(required.length).toBeGreaterThan(0)
        expect(required).not.toContain(HELPER)
        for (const file of required) expect({ file, requires: localRequires(file) }).toEqual({ file, requires: [] })
    })

    it('is where assistantHelper takes these helpers from, so there is one copy of each', () => {
        const helper = read(HELPER)
        expect(helper).toContain("require('./assistantModelRuntime')")
        for (const name of Object.keys(require('./assistantModelRuntime')).filter(key => !/^[A-Z_0-9]+$/.test(key)))
            expect(helper).not.toMatch(new RegExp(`^(async )?function ${name}\\(|^const ${name} = `, 'm'))
    })

    it('keeps one OpenAI client per key and one environment per five minutes', () => {
        const runtime = require('./assistantModelRuntime')
        expect(runtime.getOpenAIClient('key-a')).toBe(runtime.getOpenAIClient('key-a'))
        expect(runtime.getOpenAIClient('key-a')).not.toBe(runtime.getOpenAIClient('key-b'))
        expect(runtime.getCachedEnvFunctions()).toBe(runtime.getCachedEnvFunctions())
    })

    it('prices a model it knows and charges nothing for a key it does not', () => {
        const runtime = require('./assistantModelRuntime')
        expect(runtime.normalizeModelKey('MODEL_GPT5')).toBe(runtime.MODEL_GPT5_1)
        expect(runtime.normalizeModelKey(undefined)).toBe(runtime.MODEL_GPT6_SOL)
        expect(runtime.getModel(runtime.MODEL_GPT5_4_NANO)).toBe('gpt-5.4-nano')
        expect(runtime.getTokensPerGold(runtime.MODEL_GPT5_4_NANO)).toBe(1200)
        expect(runtime.calculateGoldCostFromTokens(2400, runtime.MODEL_GPT5_4_NANO)).toBe(2)
        expect(runtime.calculateGoldCostFromTokens(2400, 'MODEL_NOBODY_KNOWS')).toBe(0)
    })
})

describe('functions that have no part in an assistant run do not load the assistant', () => {
    // The dependency graph the production deploy selects by (ci/selectFunctionsDeployment.js),
    // built from the files on disk.
    const { buildGraph } = require('../../ci/selectFunctionsDeployment')
    const files = new Set(
        execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        })
            .split('\n')
            .filter(Boolean)
    )
    const graph = buildGraph({
        files,
        read: file => (files.has(file) && fs.existsSync(path.join(REPO_ROOT, file)) ? read(file) : null),
    })

    // Data triggers and telephony webhooks. They reached assistantHelper.js through a module
    // that wanted one small helper from it, and were redeployed with every assistant change.
    const OUTSIDE = [
        'onUpdateNoteSecondGen',
        'onDeleteNoteSecondGen',
        'onDeleteTaskSecondGen',
        'onUpdateGoalSecondGen',
        'onDeleteGoalSecondGen',
        'onUpdateContactSecondGen',
        'onDeleteContactSecondGen',
        'onUpdateChatSecondGen',
        'onDeleteChatSecondGen',
        'onUpdateArtifactSecondGen',
        'onDeleteArtifactSecondGen',
        'whatsAppIncomingMessage',
        'whatsAppIncomingCall',
        'phoneIncomingCall',
    ]

    it.each(OUTSIDE)('%s', name => {
        const entry = graph.get(name)
        expect(entry).toBeDefined()
        // If this fails, a module this function loads started importing assistantHelper.js.
        // Import what it needs from a module outside the assistant core (assistantModelRuntime.js
        // for model, client, env and Gold helpers), or remove the function from this list on purpose.
        expect(entry.files.has(HELPER)).toBe(false)
    })
})
