'use strict'

// The wiring ratchet. Each of these is a place where the browser tools could be half-registered —
// visible to the model but not executable, executable but not gated, gated but invisible — and none
// of those failures is loud at runtime. They are asserted against the real registries.

const fs = require('fs')
const path = require('path')

const { BROWSER_TOOL_KEY, BROWSER_TOOL_NAMES, isBrowserToolName } = require('./browserToolContract')
const { getToolSchemas, toolSchemas } = require('../toolSchemas')

const repoRoot = path.resolve(__dirname, '..', '..', '..')

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('browser tool registration', () => {
    it('has a schema for every declared tool name, and no stray browser_ schema', () => {
        for (const name of BROWSER_TOOL_NAMES) {
            expect(toolSchemas[name]).toBeDefined()
            expect(toolSchemas[name].function.name).toBe(name)
        }
        const declared = Object.keys(toolSchemas).filter(name => name.startsWith('browser_'))
        expect(declared.sort()).toEqual([...BROWSER_TOOL_NAMES].sort())
    })

    it('expands the single Tools Access key into all six schemas', () => {
        const schemas = getToolSchemas([BROWSER_TOOL_KEY])
        expect(schemas.map(schema => schema.function.name).sort()).toEqual([...BROWSER_TOOL_NAMES].sort())
    })

    it('emits nothing for an assistant without the key', () => {
        expect(getToolSchemas(['web_search', 'fetch_url']).map(schema => schema.function.name)).not.toEqual(
            expect.arrayContaining(BROWSER_TOOL_NAMES)
        )
    })

    it('tells the model that sensitive actions pause', () => {
        // A model that does not expect the pause reads the refusal as a failure and looks for a way
        // around it — which is the behaviour the whole policy exists to prevent.
        const click = toolSchemas.browser_click.function.description
        expect(click).toMatch(/approve/i)
        expect(click).toMatch(/book|pay|delete/i)
        expect(toolSchemas.browser_type.function.description).toMatch(/password|credential/i)
    })

    it('is offered in Tools Access and is opt-in only', () => {
        const source = readRepoFile('components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js')
        expect(source).toContain(`{ key: '${BROWSER_TOOL_KEY}'`)
        expect(source).toMatch(new RegExp(`OPT_IN_ONLY_TOOLS = new Set\\(\\[[^\\]]*'${BROWSER_TOOL_KEY}'`))
    })

    it('has a translated label in every shipped language', () => {
        for (const language of ['en', 'de', 'es']) {
            const translations = JSON.parse(readRepoFile(`i18n/translations/${language}.json`))
            expect(translations['Browse a website']).toBeTruthy()
            for (const name of BROWSER_TOOL_NAMES) {
                expect(translations[`assistant_activity_${name}`]).toBeTruthy()
            }
        }
    })

    it('shows a non-technical activity line and never a URL, a selector or typed text', () => {
        const { describeToolActivity } = require('../assistantToolActivity')
        const activity = describeToolActivity({
            toolName: 'browser_type',
            toolArgs: { ref: 'e2', selector: '#password', text: 'hunter2', url: 'https://example.com/login' },
        })
        expect(activity.actionKey).toBe('assistant_activity_browser_type')
        expect(activity.subject).toBeNull()
        expect(JSON.stringify(activity)).not.toContain('hunter2')
        expect(JSON.stringify(activity)).not.toContain('example.com')
    })

    it('gates execution on the single toggle in the assistant permission check', () => {
        const source = readRepoFile('functions/Assistant/assistantHelper.js')
        expect(source).toMatch(/isBrowserToolName\(toolName\)[\s\S]{0,200}includes\(BROWSER_TOOL_KEY\)/)
        // And routes execution through the policy-bearing module rather than an inline branch.
        expect(source).toContain("require('./browser/browserSession')")
    })

    it('keeps the six tools in one tool-search namespace', () => {
        const source = readRepoFile('functions/Assistant/assistantHelper.js')
        // Split across namespaces, the model finds browser_navigate and never looks for the rest.
        expect(source).toMatch(/name\.startsWith\(BROWSER_TOOL_PREFIX\)\) return 'browsing'/)
        expect(source).toMatch(/browsing: '[^']+'/)
    })

    it('exposes the same six tools on the MCP surface', () => {
        const source = readRepoFile('functions/MCP/mcpServerSimple.js')
        for (const name of BROWSER_TOOL_NAMES) expect(source).toContain(`'${name}'`)
    })

    it('whitelists the worker configuration in the env helper allowlist', () => {
        // A key missing here is silently undefined for every caller of getEnvFunctions().
        const source = readRepoFile('functions/envFunctionsHelper.js')
        for (const key of ['BROWSER_WORKER_URL', 'BROWSER_WORKER_SIGNING_SECRET', 'BROWSER_ALLOWED_DOMAINS']) {
            expect(source).toContain(key)
        }
    })

    it('registers the approval callables', () => {
        const source = readRepoFile('functions/index.js')
        expect(source).toContain('respondToBrowserApprovalSecondGen')
        expect(source).toContain('listBrowserApprovalRequestsSecondGen')
    })

    it('recognises its own tool names and nothing else', () => {
        expect(BROWSER_TOOL_NAMES.every(isBrowserToolName)).toBe(true)
        expect(isBrowserToolName('browser_automation')).toBe(false)
        expect(isBrowserToolName('browser_evil')).toBe(false)
        expect(isBrowserToolName('fetch_url')).toBe(false)
    })
})
