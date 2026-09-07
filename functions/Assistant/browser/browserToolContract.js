'use strict'

// The names and vocabulary the browser tool family shares across the whole stack: the OpenAI tool
// schemas (`toolSchemas.js`), the execution gate (`assistantHelper.isToolAllowedForExecution`), the
// MCP surface (`MCP/mcpServerSimple.js`), the policy, the audit trail and the Cloud Run worker.
//
// It is deliberately dependency-free so every one of those layers can require it without pulling in
// firebase-admin, and so a tool name can never drift between the schema list, the permission gate
// and the audit record — the drift that made `external_tool_*` unreachable in its own namespace is
// exactly the shape of failure this avoids.
//
// One Tools Access key (`browser_automation`) fans out to six tool names, mirroring how
// `get_chat_attachment` implies `list_recent_chat_media`: the six actions are one capability from
// the assistant owner's point of view, and offering six checkboxes for one feature is how a user
// ends up with a half-enabled browser that can click but not look.

const BROWSER_TOOL_KEY = 'browser_automation'

const BROWSER_TOOL_PREFIX = 'browser_'

// Order matters only for readability; the schemas are emitted in this order.
const BROWSER_TOOL_NAMES = [
    'browser_navigate',
    'browser_inspect',
    'browser_click',
    'browser_type',
    'browser_wait',
    'browser_screenshot',
]

const BROWSER_TOOL_NAME_SET = new Set(BROWSER_TOOL_NAMES)

const BROWSER_ACTION_BY_TOOL = {
    browser_navigate: 'navigate',
    browser_inspect: 'inspect',
    browser_click: 'click',
    browser_type: 'type',
    browser_wait: 'wait',
    browser_screenshot: 'screenshot',
}

// Actions that can change something on the far side. `navigate` is a GET and `inspect`/`wait`/
// `screenshot` never touch the page, so only these two are ever policy-escalated — but note that
// being in this list is what makes an action go through the two-phase describe-then-act flow in
// `browserSession.js`, which is the mechanism that stops a generic click from bypassing the gates.
const MUTATING_BROWSER_ACTIONS = new Set(['click', 'type'])

// The categories the objective names explicitly. Every one of them requires an explicit human
// approval before the action runs; none of them can be granted by the model, by a page, or by a
// tool argument. `search_submit` is deliberately NOT in here — see `browserPolicy.js`.
const SENSITIVE_CATEGORIES = [
    'login',
    'file_upload',
    'booking',
    'payment',
    'submit_publish',
    'delete',
    'external_message',
]

const SENSITIVE_CATEGORY_SET = new Set(SENSITIVE_CATEGORIES)

// Reasons an action is refused outright rather than being offered for approval. A denial is a
// statement that no approval could make the action safe in this architecture (an off-allowlist
// host, an internal address, a credential in the typed text).
const DENY_REASONS = {
    NOT_CONFIGURED: 'browser_not_configured',
    UNSUPPORTED_SCHEME: 'unsupported_scheme',
    PRIVATE_HOST: 'private_host',
    BLOCKED_HOST: 'blocked_host',
    NOT_ALLOWLISTED: 'not_allowlisted',
    CREDENTIALS_IN_URL: 'credentials_in_url',
    SECRET_IN_INPUT: 'secret_in_input',
    LIMIT_EXCEEDED: 'limit_exceeded',
    NO_SESSION: 'no_session',
    UNKNOWN_ACTION: 'unknown_action',
}

const APPROVAL_SCOPES = ['once', 'run']

function isBrowserToolName(toolName) {
    return BROWSER_TOOL_NAME_SET.has(String(toolName || ''))
}

function getBrowserActionForTool(toolName) {
    return BROWSER_ACTION_BY_TOOL[String(toolName || '')] || null
}

function isSensitiveCategory(category) {
    return SENSITIVE_CATEGORY_SET.has(String(category || ''))
}

function isMutatingBrowserAction(action) {
    return MUTATING_BROWSER_ACTIONS.has(String(action || ''))
}

module.exports = {
    APPROVAL_SCOPES,
    BROWSER_ACTION_BY_TOOL,
    BROWSER_TOOL_KEY,
    BROWSER_TOOL_NAMES,
    BROWSER_TOOL_PREFIX,
    DENY_REASONS,
    MUTATING_BROWSER_ACTIONS,
    SENSITIVE_CATEGORIES,
    getBrowserActionForTool,
    isBrowserToolName,
    isMutatingBrowserAction,
    isSensitiveCategory,
}
