'use strict'

/**
 * Who did it, and through what.
 *
 * An MCP client (Claude, Codex, …) acts with the signed-in user's own identity and rights: it is
 * not an assistant and has no account of its own, so everything it writes carries the user's id
 * as creatorId/lastEditorId. Two things follow from that and both were wrong before this module:
 *
 *   - nobody could tell an agent's work from the user's own, because the two looked identical;
 *   - the user was never notified of it, because every notification path skips the actor, and
 *     the actor was the user.
 *
 * The id stays the user's (it decides access and ownership, which is correct), and the write is
 * stamped with a marker instead: `{ via: 'mcp', viaClient: 'Claude' }`. Readers render it as
 * "Karsten Wysk (via Claude)", and every notification fan-out that skips the actor keeps the
 * actor when the marker says the change came through MCP.
 *
 * `viaClient` is never the raw string a client reports about itself: it is only ever one of the
 * labels below, because it is rendered to every member of the project. An unknown client is just
 * "via MCP".
 */

const MCP_CHANNEL = 'mcp'

// The client name the web app's own WebMCP / `window.alldone` bridge reports (AT-2871). A browser
// agent calls the tools through the signed-in page, and the page cannot know which agent (Gemini in
// Chrome, Claude in Chrome, …) is driving it, so it is labelled generically.
const BROWSER_AGENT_CLIENT_NAME = 'alldone-browser-agent'
const BROWSER_AGENT_CLIENT_LABEL = 'Browser agent'

// Matched against the `clientInfo.name` a client sends with `initialize`. Order matters: the more
// specific name comes first ("claude-code" before anything Anthropic, "codex" before OpenAI).
const MCP_CLIENT_LABELS = [
    [/alldone[\s_-]*browser[\s_-]*agent/i, BROWSER_AGENT_CLIENT_LABEL],
    [/claude[\s_-]*code/i, 'Claude Code'],
    [/codex/i, 'Codex'],
    [/anthropic|claude/i, 'Claude'],
    [/chatgpt|openai/i, 'ChatGPT'],
    [/cursor/i, 'Cursor'],
    [/windsurf|codeium/i, 'Windsurf'],
    [/gemini/i, 'Gemini'],
    [/copilot|vs\s*code|vscode/i, 'VS Code'],
]

const MCP_CLIENT_LABEL_SET = new Set(MCP_CLIENT_LABELS.map(([, label]) => label))

function resolveMcpClientLabel(rawClientName) {
    if (typeof rawClientName !== 'string' || !rawClientName.trim()) return null
    const match = MCP_CLIENT_LABELS.find(([pattern]) => pattern.test(rawClientName))
    return match ? match[1] : null
}

function normalizeViaClient(viaClient) {
    return typeof viaClient === 'string' && MCP_CLIENT_LABEL_SET.has(viaClient) ? viaClient : null
}

function buildMcpActorMarker(clientLabel) {
    const viaClient = normalizeViaClient(clientLabel)
    return viaClient ? { via: MCP_CHANNEL, viaClient } : { via: MCP_CHANNEL }
}

// True for an actor (a feedUser), a feed, a comment or a chat notification written through MCP.
function isMcpActor(subject) {
    return !!subject && subject.via === MCP_CHANNEL
}

// The marker fields to copy onto whatever this actor writes; empty for anyone else, so spreading
// it never adds a field to a non-MCP document.
function getActorChannelFields(subject) {
    return isMcpActor(subject) ? buildMcpActorMarker(subject.viaClient) : {}
}

function decorateFeedUserForRuntimeContext(feedUser, toolRuntimeContext) {
    if (!feedUser || toolRuntimeContext?.sourceChannel !== MCP_CHANNEL) return feedUser
    return { ...feedUser, ...buildMcpActorMarker(toolRuntimeContext.mcpClient) }
}

// Server-side texts (push bodies, task comments) are English, like the rest of what they say.
function formatActorDisplayName(name, subject) {
    if (!isMcpActor(subject)) return name
    const viaClient = normalizeViaClient(subject.viaClient)
    return `${name} (via ${viaClient || 'MCP'})`
}

// A task's last editor is a field the app also writes, without knowing about MCP. The stamp is
// therefore bound to the edition it describes: once anyone else edits the task, lastEditionDate
// moves on and an old stamp no longer applies.
function buildLastEditorVia(subject, editionDate) {
    if (!isMcpActor(subject)) return null
    return { ...buildMcpActorMarker(subject.viaClient), editionDate }
}

function getLastEditorChannelFields(object) {
    const stamp = object && object.lastEditorVia
    if (!isMcpActor(stamp)) return {}
    if (!object.lastEditionDate || stamp.editionDate !== object.lastEditionDate) return {}
    return buildMcpActorMarker(stamp.viaClient)
}

module.exports = {
    MCP_CHANNEL,
    MCP_CLIENT_LABELS,
    BROWSER_AGENT_CLIENT_NAME,
    BROWSER_AGENT_CLIENT_LABEL,
    resolveMcpClientLabel,
    normalizeViaClient,
    buildMcpActorMarker,
    isMcpActor,
    getActorChannelFields,
    decorateFeedUserForRuntimeContext,
    formatActorDisplayName,
    buildLastEditorVia,
    getLastEditorChannelFields,
}
