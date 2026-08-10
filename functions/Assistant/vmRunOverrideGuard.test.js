jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({ doc: jest.fn() })) }))

const {
    VALID_VM_AGENTS,
    VALID_VM_REASONING_EFFORTS,
    VALID_VM_APPROVAL_POLICIES,
    collectUserRequestText,
    resolveVmRunOverrides,
    isAgentRequested,
    isModelRequested,
    isReasoningEffortRequested,
    isApprovalPolicyRequested,
} = require('./vmRunOverrideGuard')

describe('valid value lists', () => {
    // The guard keeps its own copies so it stays dependency-free; they must still match the source
    // of truth, or an override for a newly added agent/level would be silently unguardable.
    test('match vmAgentSettings', () => {
        const settings = require('./vmAgentSettings')

        expect(VALID_VM_AGENTS).toEqual(settings.VALID_VM_AGENTS)
        expect(VALID_VM_REASONING_EFFORTS).toEqual(settings.VALID_VM_REASONING_EFFORTS)
        expect(VALID_VM_APPROVAL_POLICIES).toEqual(settings.VALID_VM_APPROVAL_POLICIES)
    })
})

describe('collectUserRequestText', () => {
    test('keeps user turns and drops assistant/system turns', () => {
        const text = collectUserRequestText([
            ['user', 'Please run this with codex'],
            ['assistant', 'Sure, I will use claude'],
            ['system', 'You are an assistant'],
        ])

        expect(text).toContain('run this with codex')
        expect(text).not.toContain('I will use claude')
        expect(text).not.toContain('You are an assistant')
    })

    test('flattens multimodal user content and plain strings', () => {
        const text = collectUserRequestText(
            [['user', [{ type: 'text', text: 'use opus for this' }, { type: 'image_url' }]]],
            'and be thorough'
        )

        expect(text).toContain('use opus for this')
        expect(text).toContain('and be thorough')
    })

    test('ignores empty and missing sources', () => {
        expect(collectUserRequestText(null, undefined, '', [])).toBe('')
    })

    test('keeps only the most recent user turns', () => {
        const history = Array.from({ length: 20 }, (_, index) => ['user', `message ${index}`])
        const text = collectUserRequestText(history)

        expect(text).toContain('message 19')
        expect(text).not.toContain('message 0\n')
    })
})

describe('override corroboration matchers', () => {
    test('recognises an agent named directly or by one of its models', () => {
        expect(isAgentRequested('please use codex for this', 'codex')).toBe(true)
        expect(isAgentRequested('run it with claude code', 'claude')).toBe(true)
        expect(isAgentRequested('use opus please', 'claude')).toBe(true)
        expect(isAgentRequested('try gpt-5.6 on this', 'codex')).toBe(true)
        expect(isAgentRequested('build the prototype in the repository', 'codex')).toBe(false)
        expect(isAgentRequested('write some code', 'claude')).toBe(false)
    })

    test('requires a model to be named in full unless it is a bare alias', () => {
        expect(isModelRequested('use sonnet', 'sonnet')).toBe(true)
        expect(isModelRequested('use claude-opus-4-8 exactly', 'claude-opus-4-8')).toBe(true)
        expect(isModelRequested('use gpt-5.6-sol', 'gpt-5.6-sol')).toBe(true)
        // A fragment of the id is not enough.
        expect(isModelRequested('this is about gpt models', 'gpt-5.6-sol')).toBe(false)
        expect(isModelRequested('opusculum is a word', 'opus')).toBe(false)
    })

    test('requires a reasoning level to sit next to effort context', () => {
        expect(isReasoningEffortRequested('use high reasoning effort', 'high')).toBe(true)
        expect(isReasoningEffortRequested('think harder, use high effort', 'high')).toBe(true)
        expect(isReasoningEffortRequested('run it at xhigh', 'xhigh')).toBe(true)
        // "high" as ordinary prose must not count.
        expect(isReasoningEffortRequested('this is high priority for the customer', 'high')).toBe(false)
        expect(isReasoningEffortRequested('keep the risk low', 'low')).toBe(false)
    })

    test('recognises a named approval policy', () => {
        expect(isApprovalPolicyRequested('be permissive with approvals', 'permissive')).toBe(true)
        expect(isApprovalPolicyRequested('use strict mode', 'strict')).toBe(true)
        expect(isApprovalPolicyRequested('just get it done', 'balanced')).toBe(false)
    })
})

describe('resolveVmRunOverrides', () => {
    const workflowStepPrompt = 'Work on this task in the VM in interactive mode. Ask questions to clarify.'

    test('drops an agent the user never asked for (AT-2224)', () => {
        const result = resolveVmRunOverrides({ requestText: workflowStepPrompt, agent: 'codex' })

        expect(result.agent).toBeUndefined()
        expect(result.ignored).toEqual([{ field: 'agent', requested: 'codex' }])
    })

    test('keeps an agent the user did ask for', () => {
        expect(resolveVmRunOverrides({ requestText: 'do this one with codex please', agent: 'codex' })).toEqual(
            expect.objectContaining({ agent: 'codex', ignored: [] })
        )
        expect(resolveVmRunOverrides({ requestText: 'run it with claude', agent: 'claude' })).toEqual(
            expect.objectContaining({ agent: 'claude', ignored: [] })
        )
    })

    test('drops an uncorroborated model together with the agent it was chosen for', () => {
        const result = resolveVmRunOverrides({
            requestText: workflowStepPrompt,
            agent: 'codex',
            agentModel: 'gpt-5.6-sol',
        })

        expect(result.agent).toBeUndefined()
        expect(result.agentModel).toBeUndefined()
        expect(result.ignored).toEqual([
            { field: 'agent', requested: 'codex' },
            { field: 'agentModel', requested: 'gpt-5.6-sol' },
        ])
    })

    test('keeps a model the user named without naming the agent', () => {
        const result = resolveVmRunOverrides({ requestText: 'use sonnet for this', agentModel: 'sonnet' })

        expect(result.agentModel).toBe('sonnet')
        expect(result.ignored).toEqual([])
    })

    test('drops an invented reasoning effort and approval policy', () => {
        const result = resolveVmRunOverrides({
            requestText: workflowStepPrompt,
            agentReasoningEffort: 'medium',
            approvalPolicy: 'balanced',
        })

        expect(result.agentReasoningEffort).toBeUndefined()
        expect(result.approvalPolicy).toBeUndefined()
        expect(result.ignored).toEqual([
            { field: 'agentReasoningEffort', requested: 'medium' },
            { field: 'approvalPolicy', requested: 'balanced' },
        ])
    })

    test('keeps a reasoning effort and approval policy the user asked for', () => {
        const result = resolveVmRunOverrides({
            requestText: 'use low reasoning effort and be permissive about approvals',
            agentReasoningEffort: 'low',
            approvalPolicy: 'permissive',
        })

        expect(result).toEqual(
            expect.objectContaining({ agentReasoningEffort: 'low', approvalPolicy: 'permissive', ignored: [] })
        )
    })

    test('passes an invalid value through so the caller still rejects it', () => {
        const result = resolveVmRunOverrides({ requestText: '', agent: 'other' })

        expect(result.agent).toBe('other')
        expect(result.ignored).toEqual([])
    })

    test('treats omitted overrides as nothing to guard', () => {
        expect(resolveVmRunOverrides({ requestText: 'anything' })).toEqual({
            agent: undefined,
            agentModel: undefined,
            agentReasoningEffort: undefined,
            approvalPolicy: undefined,
            ignored: [],
        })
        expect(resolveVmRunOverrides()).toEqual(expect.objectContaining({ ignored: [] }))
    })

    test('drops every override when there is no user-authored evidence at all', () => {
        const result = resolveVmRunOverrides({
            agent: 'codex',
            agentReasoningEffort: 'high',
            approvalPolicy: 'strict',
        })

        expect(result.agent).toBeUndefined()
        expect(result.agentReasoningEffort).toBeUndefined()
        expect(result.approvalPolicy).toBeUndefined()
    })
})

// AT-2230: OpenRouter models run through the Codex harness, so naming one is both a model request
// and an agent request. Nobody types the encoded id — they type "use deepseek".
describe('OpenRouter model overrides', () => {
    test('a vendor mention corroborates the model and the Codex harness', () => {
        const resolved = resolveVmRunOverrides({
            requestText: 'run this one with deepseek please',
            agent: 'codex',
            agentModel: 'openrouter:deepseek/deepseek-chat',
        })

        expect(resolved.agent).toBe('codex')
        expect(resolved.agentModel).toBe('openrouter:deepseek/deepseek-chat')
        expect(resolved.ignored).toEqual([])
    })

    test('naming the source alone is enough', () => {
        expect(
            resolveVmRunOverrides({
                requestText: 'use an openrouter model for this',
                agentModel: 'openrouter:qwen/qwen3-max',
            }).agentModel
        ).toBe('openrouter:qwen/qwen3-max')
    })

    // The whole point of the guard: the assistant picks a model on its own and the user's saved
    // default silently loses. An uncorroborated OpenRouter model must be dropped like any other.
    test('drops an OpenRouter model the user never asked for', () => {
        const resolved = resolveVmRunOverrides({
            requestText: 'please fix the failing login test',
            agentModel: 'openrouter:deepseek/deepseek-chat',
        })

        expect(resolved.agentModel).toBeUndefined()
        expect(resolved.ignored).toEqual([{ field: 'agentModel', requested: 'openrouter:deepseek/deepseek-chat' }])
    })

    // Matching generic tokens would make almost any sentence corroborate almost any model.
    test('a generic word inside the id is not evidence', () => {
        expect(
            resolveVmRunOverrides({
                requestText: 'summarize the chat and write it up',
                agentModel: 'openrouter:deepseek/deepseek-chat',
            }).agentModel
        ).toBeUndefined()

        expect(
            resolveVmRunOverrides({
                requestText: 'give me the free version of the report',
                agentModel: 'openrouter:deepseek/deepseek-r1:free',
            }).agentModel
        ).toBeUndefined()
    })

    test('an OpenRouter model still cannot survive a dropped agent override', () => {
        const resolved = resolveVmRunOverrides({
            requestText: 'just get it done',
            agent: 'codex',
            agentModel: 'openrouter:deepseek/deepseek-chat',
        })

        expect(resolved.agent).toBeUndefined()
        expect(resolved.agentModel).toBeUndefined()
    })
})
