import { getReasoningEffortOptions } from './AISettingsArea'
import {
    INHERIT_ASSISTANT_REASONING_EFFORT,
    MODEL_DEFAULT_REASONING_EFFORT,
} from '../../../../functions/Assistant/preConfigTaskReasoningEffort'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: value => value,
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
