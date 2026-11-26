import {
    ASSISTANT_FALLBACK_MODEL,
    getAssistantDefaultModelName,
    getAssistantDefaultModelOption,
} from './assistantDefaultModel'
import { SELECTABLE_ASSISTANT_MODELS } from '../../../../../functions/Assistant/selectableAssistantModels'

// AT-3162 follow-up: the model the "Use assistant model" entry stands for. The parity with the
// server's own resolution is pinned in functions/Assistant/assistantDefaultModelParity.test.js.
describe('getAssistantDefaultModelOption', () => {
    it.each(SELECTABLE_ASSISTANT_MODELS.map(option => [option.model, option]))(
        'names the menu entry %s',
        (key, option) => {
            expect(getAssistantDefaultModelOption(key)).toEqual({
                model: option.model,
                name: option.name,
                labelKey: option.labelKey,
            })
        }
    )

    // The production case behind the follow-up: the assistant still stores the replaced key.
    it.each([
        ['MODEL_GPT5_6_SOL', 'MODEL_GPT6_SOL', 'Sol'],
        ['MODEL_GPT5_6_LUNA', 'MODEL_GPT6_LUNA', 'Luna'],
        [' MODEL_GPT5_6_SOL ', 'MODEL_GPT6_SOL', 'Sol'],
    ])('follows the replaced key %s to %s', (stored, model, name) => {
        expect(getAssistantDefaultModelOption(stored)).toEqual(expect.objectContaining({ model, name }))
    })

    it.each([
        ['no model', undefined],
        ['null', null],
        ['a blank model', '   '],
    ])('names the server fallback (Sol) for %s', (_label, stored) => {
        expect(ASSISTANT_FALLBACK_MODEL).toBe('MODEL_GPT6_SOL')
        expect(getAssistantDefaultModelOption(stored)).toEqual(
            expect.objectContaining({ model: 'MODEL_GPT6_SOL', labelKey: 'GPT 6.1 Sol' })
        )
    })

    // The server still serves some retired keys (GPT 5.5 runs gpt-5.5); naming them Sol would be wrong.
    it.each([['MODEL_GPT5_5'], ['MODEL_SONAR'], ['MODEL_RETIRED']])('names nothing for %s', stored => {
        expect(getAssistantDefaultModelOption(stored)).toBeNull()
        expect(getAssistantDefaultModelName(stored)).toBeNull()
    })

    it('gives the short name for the composer label', () => {
        expect(getAssistantDefaultModelName('MODEL_GPT5_6_SOL')).toBe('Sol')
        expect(getAssistantDefaultModelName('MODEL_DEEPSEEK_V4_FLASH')).toBe('DeepSeek Flash')
    })
})
