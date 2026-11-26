/** @jest-environment node */
// AT-3162: the client names the model an assistant answers with ("Use assistant model" in the
// thread picker, the composers' model button) through
// components/ChatsView/ChatDV/EditorView/BotOption/assistantDefaultModel.js. It cannot import this
// runtime (the OpenAI client comes with it), so it repeats the runtime's two rules: no model means
// Sol, and replaced keys follow their successors. This holds the copy in step with the original.
//
// Only the pure key resolution is under test, so the OpenAI client is stubbed. Not as a virtual
// mock: `openai` is installed, and functions/Tests/virtualMocks.test.js forbids virtual mocks for
// modules that resolve.
jest.mock('openai', () => function OpenAI() {})

const { normalizeModelKey } = require('./assistantModelRuntime')
const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')
const {
    ASSISTANT_FALLBACK_MODEL,
    getAssistantDefaultModelOption,
} = require('../../components/ChatsView/ChatDV/EditorView/BotOption/assistantDefaultModel')

describe('the client names the model the server runs for an assistant', () => {
    it('falls back to the same model for an assistant without one', () => {
        expect(normalizeModelKey(undefined)).toBe(ASSISTANT_FALLBACK_MODEL)
        expect(normalizeModelKey('')).toBe(ASSISTANT_FALLBACK_MODEL)
        expect(getAssistantDefaultModelOption(undefined).model).toBe(ASSISTANT_FALLBACK_MODEL)
    })

    it.each([...SELECTABLE_ASSISTANT_MODELS.map(option => option.model), 'MODEL_GPT5_6_SOL', 'MODEL_GPT5_6_LUNA'])(
        'resolves %s to the model the runtime runs',
        key => {
            expect(getAssistantDefaultModelOption(key).model).toBe(normalizeModelKey(key))
        }
    )
})
