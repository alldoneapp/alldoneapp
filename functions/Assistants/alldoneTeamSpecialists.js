/**
 * The alldone.team specialists (Connor Consultant, Judy Job, Ricky Returns) as assistant templates.
 *
 * alldone.team publishes them at `alldone.team/mcp/specialists` (functions/src/alldone-mcp/specialists.ts
 * there): persona, avatar, summary, tool family, intro and the family's MCP guide. Each becomes a
 * template in `globalProject` with a fixed id, so a project adds it like any other template and
 * templateSync carries later changes into every copy. Its one MCP server entry is managed
 * (./managedMcpServers): alldone.team/mcp with `alldone_app` auth, so every call runs as the person
 * talking to the assistant and is billed to their Gold, limited by `appIds` to the specialist's own
 * app. alldone.team owns the persona; the sync rewrites only the fields it derives from the catalog
 * and leaves the rest of the template (model, tools, heartbeat) to the administrator.
 */

const crypto = require('crypto')
const { ALLDONE_TEAM_MANAGER, mergeManagedMcpServers, sameMcpServers } = require('./managedMcpServers')

const ALLDONE_TEAM_SPECIALISTS_URL = 'https://alldone.team/mcp/specialists'
const ALLDONE_TEAM_PROVIDER = 'alldone.team'
const GLOBAL_PROJECT_ID = 'globalProject'
const FETCH_TIMEOUT_MS = 10000
const MCP_SERVERS_TOOL_KEY = 'mcp_servers'

// What a specialist needs besides its own app: keep its work in Alldone (tasks, notes, artifacts),
// read what the user shares in the thread, look things up, and hand back to another assistant.
const SPECIALIST_ALLOWED_TOOLS = [
    MCP_SERVERS_TOOL_KEY,
    'create_task',
    'update_task',
    'get_tasks',
    'create_note',
    'update_note',
    'get_notes',
    'artifacts',
    'search',
    'add_chat_comment',
    'get_chat_attachment',
    'list_recent_chat_media',
    'web_search',
    'fetch_url',
    'compact_thread_context',
    'talk_to_assistant',
]

const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/

const text = (value, max) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '')

const httpsUrl = (value, allowedHost) => {
    try {
        const url = new URL(String(value || ''))
        if (url.protocol !== 'https:') return null
        if (allowedHost && url.hostname !== allowedHost) return null
        return url.toString()
    } catch (_) {
        return null
    }
}

const specialistTemplateId = specialistId => `alldone-team-${specialistId}`

/**
 * The usable entries of a catalog response. The catalog is another service's answer, so every
 * field is checked and bounded; an entry that fails is left out rather than written half-filled.
 */
function normalizeSpecialistCatalog(raw) {
    const entries = raw && Array.isArray(raw.specialists) ? raw.specialists : []
    const seen = new Set()
    return entries.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return []
        const id = text(entry.id, 40)
        const family = text(entry.family, 40)
        const persona = text(entry.persona, 80)
        const product = text(entry.product, 80)
        const intro = text(entry.intro, 2000)
        const guide = text(entry.guide, 40000)
        // alldone_app auth sends the person's alldone.app token, which only alldone.team may receive.
        const mcpUrl = httpsUrl(entry.mcpUrl, 'alldone.team')
        if (!SLUG.test(id) || !SLUG.test(family) || !persona || !product || !intro || !mcpUrl || seen.has(id)) {
            return []
        }
        seen.add(id)
        return [
            {
                id,
                family,
                persona,
                product,
                intro,
                guide,
                mcpUrl,
                summary: text(entry.summary, 300),
                avatarUrl: httpsUrl(entry.avatarUrl),
                pageUrl: httpsUrl(entry.pageUrl),
            },
        ]
    })
}

function buildSpecialistInstructions(specialist) {
    const { intro, product, guide } = specialist
    const channel = [
        'ALLDONE.APP',
        `You are an assistant in the user's Alldone project and work for whoever writes to you. Your ${product} tools on alldone.team are already connected: they run as that person, on their own ${product} data, and each action is paid with their Alldone Gold.`,
        'Ask before paid or consequential steps. Use the names the user sees, not tool names. Keep the results in Alldone as well: comment on the task you work on, and put longer results in a note or an artifact with a link to what you made.',
        guide
            ? 'The guide below is written for any agent. Ignore its parts about connectors, browser tabs, WebMCP and JavaScript: your tools are already connected here.'
            : '',
    ]
        .filter(Boolean)
        .join('\n')
    return [intro, channel, guide ? `${product.toUpperCase()} GUIDE\n${guide}` : ''].filter(Boolean).join('\n\n')
}

function buildManagedServer(specialist) {
    return {
        id: specialistTemplateId(specialist.id),
        label: `${specialist.product} (alldone.team)`,
        url: specialist.mcpUrl,
        transport: 'http',
        authType: 'alldone_app',
        appIds: [specialist.family],
        enabled: true,
        managedBy: ALLDONE_TEAM_MANAGER,
    }
}

/** The template fields that come from the catalog; the sync owns these and nothing else. */
function buildSpecialistSyncedFields(specialist) {
    const photo = specialist.avatarUrl || ''
    const fields = {
        displayName: specialist.persona,
        description: specialist.summary || specialist.product,
        photoURL: photo,
        photoURL50: photo,
        photoURL300: photo,
        instructions: buildSpecialistInstructions(specialist),
        managedServer: buildManagedServer(specialist),
        externalSource: {
            provider: ALLDONE_TEAM_PROVIDER,
            appId: specialist.id,
            family: specialist.family,
            product: specialist.product,
            pageUrl: specialist.pageUrl,
            available: true,
        },
    }
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16)
    return { ...fields, externalSource: { ...fields.externalSource, contentHash } }
}

function buildNewSpecialistTemplate(specialist, { creatorId, now }) {
    const { managedServer, ...fields } = buildSpecialistSyncedFields(specialist)
    return {
        ...fields,
        mcpServers: [managedServer],
        lastEditorId: creatorId,
        lastEditionDate: now,
        creatorId,
        createdDate: now,
        prompt: '',
        thirdPartLink: '',
        type: 'TYPE_PROMPT_BASED',
        model: 'MODEL_GPT6_SOL',
        heartbeatModel: 'MODEL_GPT6_SOL',
        reasoningEffort: null,
        temperature: 'TEMPERATURE_NORMAL',
        realtimeVoice: 'marin',
        emailSignature: `---\n${specialist.persona}\n${specialist.product} by alldone.team`,
        allowedTools: [...SPECIALIST_ALLOWED_TOOLS],
        enabledSkillIds: [],
        delegationToolDescriptionManual: '',
        delegationToolDescriptionGenerated: '',
        delegationToolDescriptionGeneratedAt: null,
        delegationToolDescriptionInputHash: '',
        lastVisitBoard: {},
        fromTemplate: false,
        isDefault: false,
        noteIdsByProject: {},
        commentsData: null,
        heartbeatAwakeStart: 28800000,
        heartbeatAwakeEnd: 79200000,
        heartbeatIntervalMs: 1800000,
        heartbeatChancePercent: 0,
        heartbeatChanceNoReplyPercent: 0,
        heartbeatSendWhatsApp: false,
        heartbeatPrompt: '',
    }
}

/** The update for an existing template, or null when it already matches the catalog. */
function buildSpecialistTemplateUpdate(existing, specialist, { editorId, now }) {
    const { managedServer, ...fields } = buildSpecialistSyncedFields(specialist)
    const allowedTools = Array.isArray(existing.allowedTools) ? existing.allowedTools : []
    const mcpServers = mergeManagedMcpServers(existing.mcpServers, [managedServer])
    const unchanged =
        existing.externalSource?.contentHash === fields.externalSource.contentHash &&
        existing.externalSource?.available === true &&
        allowedTools.includes(MCP_SERVERS_TOOL_KEY) &&
        sameMcpServers(mcpServers, existing.mcpServers)
    if (unchanged) return null
    return {
        ...fields,
        mcpServers,
        // Without it the specialist has no tools of its own at all.
        allowedTools: allowedTools.includes(MCP_SERVERS_TOOL_KEY)
            ? allowedTools
            : [...allowedTools, MCP_SERVERS_TOOL_KEY],
        lastEditorId: editorId,
        lastEditionDate: now,
    }
}

async function fetchSpecialistCatalog(fetchImpl = fetch, url = ALLDONE_TEAM_SPECIALISTS_URL) {
    const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`alldone.team specialist catalog answered ${response.status}`)
    return response.json()
}

async function getAdministratorId(db) {
    const snap = await db.doc('roles/administrator').get()
    return (snap.exists && snap.data()?.userId) || 'system'
}

/**
 * Brings the templates in line with alldone.team's catalog: creates missing ones, rewrites the
 * catalog fields of changed ones, and marks the ones alldone.team no longer offers as unavailable
 * (copies in projects keep working until removed; the Add assistant list stops offering them).
 * A catalog that cannot be read changes nothing.
 */
async function syncAlldoneTeamSpecialists({ db, fetchImpl = fetch, now = Date.now() }) {
    const specialists = normalizeSpecialistCatalog(await fetchSpecialistCatalog(fetchImpl))
    if (!specialists.length) throw new Error('alldone.team specialist catalog has no usable entries')
    const editorId = await getAdministratorId(db)
    const items = db.collection(`assistants/${GLOBAL_PROJECT_ID}/items`)
    const result = { created: [], updated: [], unchanged: [], retired: [] }

    for (const specialist of specialists) {
        const ref = items.doc(specialistTemplateId(specialist.id))
        const snap = await ref.get()
        if (!snap.exists) {
            await ref.set(buildNewSpecialistTemplate(specialist, { creatorId: editorId, now }))
            result.created.push(ref.id)
            continue
        }
        const update = buildSpecialistTemplateUpdate(snap.data(), specialist, { editorId, now })
        if (!update) {
            result.unchanged.push(ref.id)
            continue
        }
        await ref.update(update)
        result.updated.push(ref.id)
    }

    const offered = new Set(specialists.map(specialist => specialistTemplateId(specialist.id)))
    const linked = await items.where('externalSource.provider', '==', ALLDONE_TEAM_PROVIDER).get()
    for (const doc of linked.docs) {
        if (offered.has(doc.id) || doc.data().externalSource?.available === false) continue
        await doc.ref.update({ 'externalSource.available': false, lastEditorId: editorId, lastEditionDate: now })
        result.retired.push(doc.id)
    }
    return result
}

module.exports = {
    ALLDONE_TEAM_SPECIALISTS_URL,
    ALLDONE_TEAM_PROVIDER,
    SPECIALIST_ALLOWED_TOOLS,
    specialistTemplateId,
    normalizeSpecialistCatalog,
    buildSpecialistInstructions,
    buildSpecialistSyncedFields,
    buildNewSpecialistTemplate,
    buildSpecialistTemplateUpdate,
    syncAlldoneTeamSpecialists,
}
