/**
 * OpenRouter transport for the in-app assistant (AT-2238).
 *
 * ## Why this file exists at all
 *
 * The VM harness already talks to OpenRouter, but it does so from *inside a sandbox* through
 * `vmLlmProxy` — the whole point there being that the platform key must never reach the agent. None
 * of that machinery applies here: the in-app assistant runs in the Cloud Functions runtime, which is
 * already trusted with `OPEN_AI_KEY`, so it calls OpenRouter directly and `vmLlmProxy` stays a
 * VM-only concern. Sharing the proxy would mean routing a trusted server's traffic through a
 * signed-token gateway built to distrust its caller, for no benefit.
 *
 * ## The wire-protocol split, which is the actual constraint
 *
 * `assistantHelper.interactWithChatStream` drives OpenAI through the **Responses** API
 * (`openai.responses.create`: `input`, `store`, `prompt_cache_key`, hosted tool-search, typed
 * `response.*` events). Responses is OpenAI's own API — OpenRouter exposes the OpenAI-*compatible*
 * **Chat Completions** surface and nothing else. This is the same lesson `vmJobRunner` already
 * learned for Codex (`wire_api = "chat"` for OpenRouter vs `"responses"` for OpenAI); asking
 * OpenRouter for Responses fails at the first request with an error that reads like a proxy bug.
 *
 * So an OpenRouter model cannot reuse the Responses request path, and this module is the second
 * path. It deliberately terminates at the **same stream contract** the rest of the assistant runtime
 * consumes, so nothing downstream of `interactWithChatStream` needs to know which wire protocol
 * produced a run:
 *
 *     { content: '<text delta>', additional_kwargs: {} }                       // 0..n times
 *     { content: '', additional_kwargs: { tool_calls: [...] } }                // once, if any
 *
 * where each tool call is `{ id, type: 'function', function: { name, arguments } }` — which is
 * already the Chat Completions shape, so tool calls need accumulation but no translation.
 *
 * ## Two things that are easy to get wrong here
 *
 * 1. **`stream_options.include_usage`.** Chat Completions omits `usage` from a stream unless it is
 *    explicitly requested — the exact trap `vmLlmProxy.ensureStreamUsageRequested` exists to patch
 *    for the sandbox path. In-app Gold is metered by a local tiktoken count rather than by reported
 *    usage, so omitting it would not mis-bill, but it would leave every OpenRouter run with no
 *    upstream token telemetry at all. We ask for it and log it.
 * 2. **Deferred tool-loading is OpenAI-only.** `buildResponsesTools`' tool-search mode is a
 *    Responses feature, so OpenRouter runs always send the full function schemas. That is a context
 *    cost, not a correctness problem, and DeepSeek V4 Flash's 1M-token window absorbs it comfortably.
 */

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/**
 * Attribution headers OpenRouter surfaces on its activity dashboard. Optional for the API, useful
 * for telling in-app assistant traffic apart from VM traffic when reading the bill. Mirrors the
 * `extraHeaders` on `vmLlmProxy`'s OpenRouter provider entry.
 */
const OPENROUTER_HEADERS = Object.freeze({
    'HTTP-Referer': 'https://my.alldone.app',
    'X-Title': 'Alldone',
})

const openRouterClients = new Map()

/**
 * Cached per key, matching `assistantHelper.getOpenAIClient`. The OpenAI SDK is a thin HTTP wrapper
 * but constructing one per request still re-creates its agent/dispatcher, which showed up in the
 * timing logs the assistant path is instrumented with.
 */
function getOpenRouterClient(apiKey) {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.')
    if (!openRouterClients.has(apiKey)) {
        // Required lazily so the pure parts of this module — the stream converter and the message
        // mapper, which are where the real logic lives — stay importable and testable without the
        // SDK being resolvable.
        const OpenAI = require('openai')
        openRouterClients.set(
            apiKey,
            new OpenAI({
                apiKey,
                baseURL: OPENROUTER_BASE_URL,
                defaultHeaders: { ...OPENROUTER_HEADERS },
            })
        )
    }
    return openRouterClients.get(apiKey)
}

/**
 * Stand-in for an image the selected model cannot see. Kept descriptive rather than silent: the
 * assistant can then say "I can't view the attachment" instead of confidently answering as if no
 * image had been sent.
 */
const UNSUPPORTED_IMAGE_PLACEHOLDER = '[An image was attached, but the selected model cannot read images.]'

/**
 * Multi-part content, flattened when the target model is text-only.
 *
 * The assistant's internal message format is already Chat Completions-native (`{type:'text'}` /
 * `{type:'image_url'}`) — `convertMessagesToResponsesInput` translates *out* of it for the OpenAI
 * Responses path — so no translation is needed here. The one thing that does need handling is
 * modality: DeepSeek V4 Flash reports `input_modalities: ['text']`, and sending it an `image_url`
 * part fails the whole request. Replacing the part keeps a text-only model usable in a thread that
 * happens to contain an attachment, which is otherwise a hard failure the user cannot diagnose.
 *
 * An all-text part list is collapsed back to a plain string: some OpenAI-compatible providers accept
 * the parts array only on `user` messages, and a string is universally accepted.
 */
function normalizeContentForChatCompletions(content, { supportsImages = false } = {}) {
    if (!Array.isArray(content)) return content ?? ''

    const parts = content.map(part => {
        if (!part || typeof part !== 'object') return { type: 'text', text: String(part ?? '') }
        if (part.type === 'image_url' && !supportsImages) {
            return { type: 'text', text: UNSUPPORTED_IMAGE_PLACEHOLDER }
        }
        return part
    })

    if (parts.every(part => part.type === 'text')) {
        return parts
            .map(part => part.text || '')
            .filter(Boolean)
            .join('\n')
    }
    return parts
}

/**
 * Chat Completions rejects the extra keys the Responses path threads through its message objects
 * (`promptCacheBreakpoint` is ours, not OpenAI's), so messages are rebuilt field by field rather
 * than spread. `tool_calls`/`tool_call_id` are carried through untouched because the assistant's
 * tool loop feeds prior rounds back in and OpenRouter needs them to reconstruct the exchange.
 */
function toChatCompletionsMessages(messages, { supportsImages = false } = {}) {
    if (!Array.isArray(messages)) throw new Error('Messages must be an array')

    return messages.map(msg => {
        if (Array.isArray(msg)) {
            return { role: msg[0], content: normalizeContentForChatCompletions(msg[1], { supportsImages }) }
        }
        if (!msg || typeof msg !== 'object' || !msg.role) {
            throw new Error('Unexpected message format')
        }

        const converted = {
            role: msg.role,
            // A tool result must stay a string; JSON.stringify mirrors what the Responses path does
            // with a non-string `function_call_output`.
            content:
                msg.role === 'tool' && typeof msg.content !== 'string'
                    ? JSON.stringify(msg.content ?? '')
                    : normalizeContentForChatCompletions(msg.content, { supportsImages }),
        }
        if (msg.tool_calls) converted.tool_calls = msg.tool_calls
        if (msg.tool_call_id) converted.tool_call_id = msg.tool_call_id
        if (msg.name) converted.name = msg.name
        return converted
    })
}

/**
 * Streamed tool calls arrive as fragments keyed by `index`: the first fragment carries `id` and
 * `function.name`, later ones append `function.arguments` a few characters at a time. Accumulating
 * by index (not by id — later fragments omit it) is the whole job.
 */
function accumulateToolCallDeltas(accumulator, toolCallDeltas) {
    for (const delta of toolCallDeltas) {
        if (!delta) continue
        const index = typeof delta.index === 'number' ? delta.index : accumulator.size
        const existing = accumulator.get(index) || {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
        }

        if (delta.id) existing.id = delta.id
        if (delta.type) existing.type = delta.type
        if (delta.function?.name) existing.function.name = delta.function.name
        if (delta.function?.arguments) existing.function.arguments += delta.function.arguments

        accumulator.set(index, existing)
    }
}

/**
 * Convert an OpenRouter Chat Completions stream into the assistant's stream contract.
 *
 * Exported separately from `streamOpenRouterChat` so it can be unit-tested against a plain async
 * iterable of chunks without an HTTP layer or an SDK mock.
 */
async function* convertChatCompletionsStream(stream, usageContext = {}) {
    const accumulatedToolCalls = new Map()
    let totalContentLength = 0
    let finishReason = null
    let usage = null

    for await (const chunk of stream) {
        // OpenRouter forwards upstream provider errors as an `error` member on an otherwise
        // well-formed chunk rather than as an HTTP status, so a stream can fail mid-flight.
        if (chunk?.error) {
            throw new Error(chunk.error.message || 'OpenRouter stream failed')
        }
        if (chunk?.usage) usage = chunk.usage

        const choice = chunk?.choices?.[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason

        const delta = choice.delta
        if (!delta) continue

        if (delta.content) {
            totalContentLength += delta.content.length
            yield { content: delta.content, additional_kwargs: {} }
        }

        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
            accumulateToolCallDeltas(accumulatedToolCalls, delta.tool_calls)
        }
    }

    // An arguments fragment that never got a name belongs to no callable tool; emitting it would
    // make the tool loop dispatch on an empty name. Dropping it degrades to "model said nothing",
    // which the empty-response guard below reports honestly.
    const completedToolCalls = Array.from(accumulatedToolCalls.values())
        .filter(toolCall => toolCall.function.name)
        .map(toolCall => ({
            id: toolCall.id || `call_${toolCall.function.name}`,
            type: 'function',
            function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments || '{}',
            },
        }))

    if (completedToolCalls.length > 0) {
        yield { content: '', additional_kwargs: { tool_calls: completedToolCalls } }
    }

    if (usage) {
        console.log('📊 OPENROUTER USAGE: Chat completion finished', {
            route: usageContext.route || 'assistant',
            model: usageContext.model || null,
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
            finishReason,
        })
    }

    if (totalContentLength === 0 && completedToolCalls.length === 0) {
        throw new Error(
            `OpenRouter returned an empty response${finishReason ? ` (finish_reason: ${finishReason})` : ''}`
        )
    }
}

/**
 * Open a streaming OpenRouter chat completion and return it already converted to the assistant's
 * stream contract.
 *
 * `tools` are the same `{ type: 'function', function: {...} }` schemas `getToolSchemas` produces for
 * the OpenAI path — Chat Completions is where that shape comes from, so they are passed straight
 * through.
 */
async function streamOpenRouterChat({
    apiKey,
    model,
    messages,
    tools = null,
    temperature = null,
    supportsImages = false,
    usageContext = {},
} = {}) {
    if (!model) throw new Error('Model name is required')

    const client = getOpenRouterClient(apiKey)
    const requestParams = {
        model,
        messages: toChatCompletionsMessages(messages, { supportsImages }),
        stream: true,
        // Chat Completions drops `usage` from a stream unless it is explicitly requested.
        stream_options: { include_usage: true },
    }
    if (Array.isArray(tools) && tools.length > 0) requestParams.tools = tools
    if (Number.isFinite(temperature)) requestParams.temperature = temperature

    console.log('🌐 OPENROUTER: Creating chat completion stream', {
        model,
        messageCount: requestParams.messages.length,
        toolCount: requestParams.tools?.length || 0,
        hasTemperature: Number.isFinite(temperature),
        route: usageContext.route || 'assistant',
    })

    const stream = await client.chat.completions.create(requestParams)
    return convertChatCompletionsStream(stream, { ...usageContext, model })
}

module.exports = {
    OPENROUTER_BASE_URL,
    OPENROUTER_HEADERS,
    UNSUPPORTED_IMAGE_PLACEHOLDER,
    getOpenRouterClient,
    normalizeContentForChatCompletions,
    toChatCompletionsMessages,
    convertChatCompletionsStream,
    streamOpenRouterChat,
}
