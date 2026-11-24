import {
    ANNA_TEMPLATE_ROUTE_CHAT,
    ANNA_TEMPLATE_ROUTE_TASK,
    getAnnaTemplateMessageText,
    getAnnaTemplateRoute,
} from './annaTemplateRouting'

// AT-3153: which templates picked in the Anna chat are answered there as a normal message, and
// which keep their own task because the chat path could not apply their settings.

const chat = { projectId: 'p1', assistantId: 'anna' }
const historicalFact = {
    id: 'tpl-1',
    name: 'Historical fact of the day',
    type: 'prompt',
    prompt: 'Tell me a historical fact about today.',
    variables: [],
    projectId: 'p1',
    assistantId: 'anna',
    assistant: { uid: 'anna', instructions: 'Be Anna.' },
    aiModel: null,
    sendWhatsApp: false,
}

describe('getAnnaTemplateRoute', () => {
    it('answers a plain template of the chat’s own assistant in the chat', () => {
        expect(getAnnaTemplateRoute(historicalFact, chat)).toBe(ANNA_TEMPLATE_ROUTE_CHAT)
        expect(getAnnaTemplateRoute({ ...historicalFact, executionMode: 'direct' }, chat)).toBe(
            ANNA_TEMPLATE_ROUTE_CHAT
        )
    })

    it('treats a saved copy of the assistant’s own instructions as no override', () => {
        expect(getAnnaTemplateRoute({ ...historicalFact, aiSystemMessage: '  Be Anna. ' }, chat)).toBe(
            ANNA_TEMPLATE_ROUTE_CHAT
        )
        expect(getAnnaTemplateRoute({ ...historicalFact, aiSystemMessage: 'Be a historian.' }, chat)).toBe(
            ANNA_TEMPLATE_ROUTE_TASK
        )
    })

    it('uses the filled-in prompt of a template with variables', () => {
        const form = { ...historicalFact, prompt: 'Tell me about $Topic', variables: [{ name: 'Topic' }] }
        expect(getAnnaTemplateRoute(form, chat, 'Tell me about Berlin')).toBe(ANNA_TEMPLATE_ROUTE_CHAT)
        expect(getAnnaTemplateRoute(form, chat, '   ')).toBe(ANNA_TEMPLATE_ROUTE_TASK)
    })

    it.each([
        ['another assistant', { assistantId: 'cto' }],
        ['another project', { projectId: 'p2' }],
        ['its own model', { aiModelOverride: 'gpt-5.5' }],
        ['its own model (resolved field)', { aiModel: 'gpt-5.5' }],
        ['its own reasoning effort', { aiReasoningEffort: 'high' }],
        ['the model-default reasoning effort', { aiReasoningEffort: null }],
        ['WhatsApp delivery', { sendWhatsApp: true }],
        ['workflow mode', { executionMode: 'workflow' }],
        ['a webhook', { type: 'webhook', prompt: '', taskMetadata: { isWebhookTask: true } }],
        ['an empty prompt', { prompt: '' }],
    ])('keeps its own task for a template with %s', (_label, change) => {
        expect(getAnnaTemplateRoute({ ...historicalFact, ...change }, chat)).toBe(ANNA_TEMPLATE_ROUTE_TASK)
    })

    it('keeps its own task when the chat is not known yet', () => {
        expect(getAnnaTemplateRoute(historicalFact, {})).toBe(ANNA_TEMPLATE_ROUTE_TASK)
        expect(getAnnaTemplateRoute(null, chat)).toBe(ANNA_TEMPLATE_ROUTE_TASK)
    })
})

describe('getAnnaTemplateMessageText', () => {
    it('shows the prompt that runs, or the name of a template without a prompt', () => {
        expect(getAnnaTemplateMessageText(historicalFact)).toBe('Tell me a historical fact about today.')
        expect(getAnnaTemplateMessageText(historicalFact, ' Filled in ')).toBe('Filled in')
        expect(getAnnaTemplateMessageText({ name: 'Deploy hook', prompt: '' })).toBe('Deploy hook')
        expect(getAnnaTemplateMessageText({ name: '', prompt: '' })).toBe('')
    })
})
