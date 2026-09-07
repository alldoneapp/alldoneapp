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

    it('routes static fetches and client-rendered pages without search-loop ambiguity', () => {
        const fetchDescription = toolSchemas.fetch_url.function.description
        const navigateDescription = toolSchemas.browser_navigate.function.description

        expect(fetchDescription).toMatch(/without running JavaScript/i)
        expect(fetchDescription).toContain('#/...')
        expect(fetchDescription).toMatch(/browser_navigate/)
        expect(fetchDescription).toMatch(/repeated web_search/i)
        expect(navigateDescription).toMatch(/SPA|#\/\.\.\./i)
        expect(navigateDescription).toMatch(/fetch_url succeeded technically/i)
        expect(navigateDescription).toMatch(/project policy/i)
        expect(navigateDescription).not.toMatch(/Only allowlisted sites/i)
    })

    it('reuses fresh refs returned by browser actions instead of billing redundant inspections', () => {
        expect(toolSchemas.browser_inspect.function.description).toMatch(/only when the page may have changed/i)
        expect(toolSchemas.browser_click.function.description).toMatch(/latest browser result/i)
        expect(toolSchemas.browser_type.function.description).toMatch(/latest browser result/i)
        expect(toolSchemas.browser_click.function.description).toMatch(/only when the ref is missing or stale/i)
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

    it('reaches the allowlist editor from the tool row that needs it', () => {
        // Ticking "Browse a website" and finding that nothing works — because the allowlist is
        // default deny and empty — is the failure this row exists to prevent.
        const modal = readRepoFile('components/UIComponents/FloatModals/AssistantToolsModal/AssistantToolsModal.js')
        expect(modal).toContain('BROWSER_TOOL_KEY')
        expect(modal).toContain('onEditBrowserAllowlist')

        const wrapper = readRepoFile(
            'components/AssistantDetailedView/Customizations/ToolsAccess/ToolsAccessWrapper.js'
        )
        expect(wrapper).toContain('BrowserAllowlistModal')
        // Sequential, never nested: a nested react-tiny-popover dismisses its parent on a tap.
        expect(wrapper).toMatch(/setIsOpen\(false\)[\s\S]{0,80}setAllowlistOpen\(true\)/)
    })

    it('lets the thread render a pending approval', () => {
        const rules = readRepoFile('firestore.rules')
        // Read-only, and only for the person the request was raised for.
        expect(rules).toContain('match /browserApprovals/{approvalId}')
        expect(rules).toMatch(/browserApprovals[\s\S]{0,300}allow write: if false/)

        const body = readRepoFile('components/ChatsView/ChatDV/EditorView/MessageItemBody.js')
        expect(body).toContain('BrowserApprovalCard')
    })

    it('has a Gold label and a source that the transactions modal knows', () => {
        const { BROWSER_GOLD_SOURCE } = require('./browserGold')
        const modal = readRepoFile('components/SettingsView/Profile/Properties/GoldTransactionsModal.js')
        expect(modal).toContain(`${BROWSER_GOLD_SOURCE}: 'Website visit'`)
        for (const language of ['en', 'de', 'es']) {
            const translations = JSON.parse(readRepoFile(`i18n/translations/${language}.json`))
            expect(translations['Website visit']).toBeTruthy()
        }
    })

    it('keeps the access mode a SIGNED claim rather than a request parameter', () => {
        // The client-only-bypass question: everything that decides "which hosts" has to be inside
        // the HMAC-signed token, and the worker has to read it from there.
        const client = readRepoFile('functions/Assistant/browser/browserWorkerClient.js')
        expect(client).toMatch(/mode: accessMode === 'all_public'/)
        expect(client).toContain('deny: (Array.isArray(denylist)')

        const actions = readRepoFile('functions/Assistant/browser-worker/browserActions.js')
        // The worker asks the same function Functions asks, so `all_public` cannot mean something
        // looser at the network layer than it meant in the policy.
        expect(actions).toContain("requireShared('browserAllowlist')")
        expect(actions).toContain('checkUrlAgainstAllowlist(url, policy)')
        expect(actions).not.toMatch(/hostMatchesEntry\(parsed\.hostname/)
    })

    it('offers the three modes with a warning, in every shipped language', () => {
        const modal = readRepoFile('components/UIComponents/FloatModals/BrowserAllowlistModal/BrowserAllowlistModal.js')
        expect(modal).toContain('browser_mode_all_public_warning')
        expect(modal).toContain('browser_mode_all_public_still_blocked')
        expect(modal).toContain('BROWSER_ACCESS_MODE_ALL_PUBLIC')

        for (const language of ['en', 'de', 'es']) {
            const translations = JSON.parse(readRepoFile(`i18n/translations/${language}.json`))
            for (const key of [
                'browser_mode_off',
                'browser_mode_selected',
                'browser_mode_all_public',
                'browser_mode_all_public_warning',
                'browser_mode_all_public_still_blocked',
                'browser_allowlist_unused_in_all_public',
                'Blocked websites',
            ]) {
                expect(translations[key]).toBeTruthy()
            }
        }
    })

    it('bills one Gold per executed step and nothing else', () => {
        // The product decision, ratcheted: refused / paused / failed steps stay free.
        const { BROWSER_STEP_GOLD } = require('./browserGold')
        expect(BROWSER_STEP_GOLD).toBe(1)

        const session = readRepoFile('functions/Assistant/browser/browserSession.js')
        const chargeIndex = session.indexOf('chargeGoldForBrowserStep({')
        const actIndex = session.indexOf("operation: 'act'")
        // The charge sits AFTER the worker call and after its failure branch returns, which is what
        // makes "only executed steps" true by construction rather than by a condition.
        expect(chargeIndex).toBeGreaterThan(actIndex)
        // And the charge is keyed on the step id, so a replay of the whole call cannot charge twice.
        expect(readRepoFile('functions/Assistant/browser/browserGold.js')).toContain(
            'idempotencyKey: buildIdempotencyKey(stepId)'
        )
    })

    it('drives the shared Switch with the props that component actually takes (AT-2518)', () => {
        // The production crash: `value`/`onValueChange` are React Native core names, and this repo's
        // Switch takes `active`/`activeSwitch`/`deactiveSwitch`. The mismatch threw
        // `TypeError: t is not a function` out of PressResponder on every press and left the toggle
        // permanently off. A ratchet, because the wrong names look right.
        const modal = readRepoFile('components/UIComponents/FloatModals/BrowserAllowlistModal/BrowserAllowlistModal.js')
        expect(modal).toMatch(/<Switch[\s\S]{0,240}activeSwitch=/)
        expect(modal).toMatch(/<Switch[\s\S]{0,240}deactiveSwitch=/)
        expect(modal).not.toMatch(/<Switch[\s\S]{0,240}onValueChange=/)
    })

    it('writes the allowlist to the project on screen, not to the assistant home project', () => {
        // A global assistant lives in the global project, which is not a workspace and holds no
        // browsing configuration — writing there is refused, and the server reads the configuration
        // from the project a browsing run happens in anyway.
        const customizations = readRepoFile(
            'components/AssistantDetailedView/Customizations/AssistantCustomizations.js'
        )
        expect(customizations).toMatch(/configProjectId=\{projectDetailedId\}/)

        const wrapper = readRepoFile(
            'components/AssistantDetailedView/Customizations/ToolsAccess/ToolsAccessWrapper.js'
        )
        expect(wrapper).toContain('const allowlistProjectId = configProjectId || projectId')
        expect(wrapper).toMatch(/projectId=\{allowlistProjectId\}/)
        // And the assistant document keeps being written where it lives.
        expect(wrapper).toContain('updateAssistant(projectId,')
    })

    it('writes the configuration with a merge rather than an update', () => {
        // `update` rejects with `not-found` on a document it has never touched and writes nothing;
        // a settings field must not depend on somebody else having written it first.
        const backend = readRepoFile('utils/backends/Projects/projectsFirestore.js')
        expect(backend).toMatch(/setProjectBrowserAutomation[\s\S]{0,600}\{ merge: true \}/)
        expect(backend).toMatch(/setProjectBrowserAutomation[\s\S]{0,300}if \(!projectId\)/)
    })

    it('recognises its own tool names and nothing else', () => {
        expect(BROWSER_TOOL_NAMES.every(isBrowserToolName)).toBe(true)
        expect(isBrowserToolName('browser_automation')).toBe(false)
        expect(isBrowserToolName('browser_evil')).toBe(false)
        expect(isBrowserToolName('fetch_url')).toBe(false)
    })
})
