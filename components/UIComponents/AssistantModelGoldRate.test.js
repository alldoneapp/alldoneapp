import React from 'react'
import renderer from 'react-test-renderer'

import AssistantModelGoldRate, { getAssistantModelGoldRateText } from './AssistantModelGoldRate'

jest.mock('../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => key.replace('%{tokens}', values.tokens || ''),
}))

describe('AssistantModelGoldRate', () => {
    test.each([
        ['MODEL_GPT6_SOL', '1 Gold = 200 tokens'],
        ['MODEL_GPT5_6_TERRA', '1 Gold = 200 tokens'],
        ['MODEL_GPT6_LUNA', '1 Gold = 1,000 tokens'],
        ['MODEL_DEEPSEEK_V4_FLASH', '1 Gold = 2,000 tokens'],
    ])('formats the actual assistant billing rate for %s', (model, expected) => {
        expect(getAssistantModelGoldRateText({ model })).toBe(expected)
    })

    test('shows the replacement rate for an assistant with a saved 5.6 model key', () => {
        expect(getAssistantModelGoldRateText({ model: 'MODEL_GPT5_6_SOL' })).toBe('1 Gold = 200 tokens')
        expect(getAssistantModelGoldRateText({ model: 'MODEL_GPT5_6_LUNA' })).toBe('1 Gold = 1,000 tokens')
    })

    test('renders nothing for an unknown or unpriced model', () => {
        expect(getAssistantModelGoldRateText({ model: 'MODEL_UNKNOWN' })).toBe('')
        expect(renderer.create(<AssistantModelGoldRate model="MODEL_UNKNOWN" />).toJSON()).toBeNull()
    })
})
