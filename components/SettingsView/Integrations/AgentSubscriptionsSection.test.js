import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TextInput } from 'react-native'

import { ProviderAuthCard } from './AgentSubscriptionsSection'
import { removeVmApiKey, saveVmApiKey, setVmCredentialMode, testVmApiKey } from '../../../utils/backends/firestore'

jest.mock('../../UIControls/Button', () => {
    const React = require('react')
    return props => React.createElement('MockButton', props)
})
jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { subtitle1: {}, subtitle2: {}, body2: {}, caption1: {}, title6: {} },
    colors: {
        Text01: '#111',
        Text02: '#222',
        Text03: '#333',
        Grey300: '#ddd',
        Grey400: '#ccc',
        Primary100: '#00f',
        UtilityGreen100: '#efe',
        UtilityGreen300: '#080',
        UtilityRed200: '#f00',
    },
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../../../utils/backends/firestore', () => ({
    connectVmSubscription: jest.fn(async () => ({})),
    disconnectVmSubscription: jest.fn(async () => ({})),
    getVmSubscriptionStatus: jest.fn(async () => ({})),
    removeVmApiKey: jest.fn(async () => ({})),
    saveVmApiKey: jest.fn(async () => ({})),
    setVmCredentialMode: jest.fn(async () => ({})),
    testVmApiKey: jest.fn(async () => ({})),
}))

describe('AgentSubscriptionsSection provider BYOK states', () => {
    const onChanged = jest.fn(async () => {})

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('shows saved/active BYOK without ever rendering the saved key', () => {
        const rawKey = 'sk-provider-secret-that-must-not-render'
        const tree = renderer.create(
            <ProviderAuthCard
                provider="claude"
                connection={{
                    connected: true,
                    activeMode: 'byok',
                    apiKey: { connected: true, validationStatus: 'valid', rawKey },
                }}
                onChanged={onChanged}
            />
        )

        const output = JSON.stringify(tree.toJSON())
        expect(output).toContain('Using your personal API key')
        expect(output).toContain('API key saved and validated')
        expect(output).not.toContain(rawKey)
    })

    test('validates and saves a replacement, then clears it from component state', async () => {
        const tree = renderer.create(
            <ProviderAuthCard
                provider="codex"
                connection={{ activeMode: 'api', apiKey: { connected: false } }}
                onChanged={onChanged}
            />
        )
        const input = tree.root
            .findAllByType(TextInput)
            .find(node => node.props.placeholder === 'Paste your OpenAI API key')

        await act(async () => {
            input.props.onChangeText('sk-openai-replacement-key-123456789')
        })
        const saveButton = tree.root
            .findAllByType('MockButton')
            .find(node => node.props.title === 'Validate and save key')
        await act(async () => {
            await saveButton.props.onPress()
        })

        expect(saveVmApiKey).toHaveBeenCalledWith({
            provider: 'codex',
            apiKey: 'sk-openai-replacement-key-123456789',
        })
        expect(input.props.value).toBe('')
        expect(onChanged).toHaveBeenCalled()
    })

    test('supports testing, removing and switching a saved provider key', async () => {
        const tree = renderer.create(
            <ProviderAuthCard
                provider="claude"
                connection={{
                    connected: true,
                    activeMode: 'subscription',
                    apiKey: { connected: true, validationStatus: 'valid' },
                }}
                onChanged={onChanged}
            />
        )
        const button = title => tree.root.findAllByType('MockButton').find(node => node.props.title === title)

        await act(async () => {
            await button('Test saved key').props.onPress()
        })
        expect(testVmApiKey).toHaveBeenCalledWith({ provider: 'claude' })

        await act(async () => {
            await button('Personal API key').props.onPress()
        })
        expect(setVmCredentialMode).toHaveBeenCalledWith({ provider: 'claude', mode: 'byok' })

        await act(async () => {
            await button('Remove key').props.onPress()
        })
        expect(removeVmApiKey).toHaveBeenCalledWith({ provider: 'claude' })
    })

    test('disables BYOK selection until a key has been saved', () => {
        const tree = renderer.create(
            <ProviderAuthCard
                provider="codex"
                connection={{ activeMode: 'api', apiKey: { connected: false } }}
                onChanged={onChanged}
            />
        )
        const byokButton = tree.root.findAllByType('MockButton').find(node => node.props.title === 'Personal API key')
        expect(byokButton.props.disabled).toBe(true)
    })
})
