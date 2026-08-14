import { getModelOptions, getReasoningEffortOptions } from './AISettingsArea'
import {
    INHERIT_ASSISTANT_REASONING_EFFORT,
    MODEL_DEFAULT_REASONING_EFFORT,
} from '../../../../functions/Assistant/preConfigTaskReasoningEffort'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (value, values = {}) => value.replace('%{tokens}', values.tokens || ''),
    getDeviceLanguage: () => 'en',
}))
jest.mock('./DropDown', () => 'DropDown')
jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    NEW_TOPIC_MODAL_THEME: 'theme',
}))
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: { subtitle1: {}, subtitle2: {}, body1: {} },
    colors: { Text01: '#fff', Text02: '#fff', Text03: '#fff', Grey400: '#333' },
}))

describe('pre-configured task advanced AI settings', () => {
    test('shows Gold pricing on every explicit model choice', () => {
        expect(getModelOptions().map(option => option.label)).toEqual([
            'Use assistant model',
            'GPT 5_6 Sol · 1 Gold = 100 tokens',
            'GPT 5_6 Terra · 1 Gold = 200 tokens',
            'GPT 5_6 Luna · 1 Gold = 500 tokens',
            'DeepSeek V4 Flash · 1 Gold = 2,000 tokens',
        ])
    })

    test('offers reasoning effort choices instead of temperature choices', () => {
        const options = getReasoningEffortOptions()

        expect(options.map(option => option.value)).toEqual([
            INHERIT_ASSISTANT_REASONING_EFFORT,
            MODEL_DEFAULT_REASONING_EFFORT,
            'none',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ])
        expect(options.map(option => option.label)).not.toContain('Temperature')
    })
})
