import { translate } from '../i18n/TranslationService'
import { isMcpActor, normalizeViaClient } from '../functions/shared/mcpActor'

/**
 * The app side of functions/shared/mcpActor.js: something an MCP client (Claude, Codex, …) did in a
 * user's name keeps the user as its author, and is shown as "Karsten Wysk (via Claude)". `subject` is
 * the feed, comment or other document that carries the `via` / `viaClient` marker.
 */

// Brand names stay as they are; the generic label of the web app's own WebMCP bridge is translated.
const TRANSLATED_CLIENT_LABELS = new Set(['Browser agent'])

export const getMcpClientDisplayName = subject => {
    const client = normalizeViaClient(subject?.viaClient) || 'MCP'
    return TRANSLATED_CLIENT_LABELS.has(client) ? translate(client) : client
}

export const withMcpActorLabel = (name, subject) => {
    if (!isMcpActor(subject) || !name) return name
    return translate('Actor via MCP client', { name, client: getMcpClientDisplayName(subject) })
}

export { isMcpActor }
