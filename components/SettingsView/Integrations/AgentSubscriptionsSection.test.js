import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TextInput } from 'react-native'

import { ProviderAuthCard } from './AgentSubscriptionsSection'
import {
    connectVmSubscription,
    removeVmApiKey,
    saveVmApiKey,
    setVmCredentialMode,
    testVmApiKey,
} from '../../../utils/backends/firestore'

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

    test('places web credential fields in forms and disables browser autofill', () => {
        const tree = renderer.create(
            <ProviderAuthCard
                provider="claude"
                connection={{ activeMode: 'api', apiKey: { connected: false } }}
                onChanged={onChanged}
            />
        )

        const forms = tree.root.findAllByType('form')
        const inputs = tree.root.findAllByType(TextInput)
        expect(forms).toHaveLength(2)
        expect(forms.every(form => form.props.autoComplete === 'off')).toBe(true)
        expect(inputs).toHaveLength(2)
        expect(inputs.every(input => input.props.autoComplete === 'off')).toBe(true)
        expect(inputs.every(input => input.props.secureTextEntry)).toBe(true)
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

    test('reconnects a connected subscription with a fresh credential', async () => {
        const tree = renderer.create(
            <ProviderAuthCard
                provider="codex"
                connection={{ connected: true, activeMode: 'subscription', apiKey: { connected: false } }}
                onChanged={onChanged}
            />
        )
        const input = tree.root
            .findAllByType(TextInput)
            .find(node => node.props.placeholder === 'Paste the complete contents of ~/.codex/auth.json')
        const freshCredential = '{"auth_mode":"chatgpt","tokens":{"refresh_token":"fresh-token"}}'

        await act(async () => {
            input.props.onChangeText(freshCredential)
        })
        const reconnectButton = tree.root
            .findAllByType('MockButton')
            .find(node => node.props.title === 'Reconnect subscription')
        await act(async () => {
            await reconnectButton.props.onPress()
        })

        expect(connectVmSubscription).toHaveBeenCalledWith({
            provider: 'codex',
            credential: freshCredential,
        })
        expect(input.props.value).toBe('')
        expect(onChanged).toHaveBeenCalled()
    })
})

// AT-2230 BYOK. OpenRouter is a credential provider without a subscription: the card must offer
// exactly two routes and never imply a plan the user cannot connect.
describe('AgentSubscriptionsSection OpenRouter card', () => {
    const onChanged = jest.fn(async () => {})

    beforeEach(() => {
        jest.clearAllMocks()
    })

    const renderCard = (connection = { activeMode: 'api', apiKey: { connected: false } }) =>
        renderer.create(<ProviderAuthCard provider="openrouter" connection={connection} onChanged={onChanged} />)

    test('offers only "Personal API key" and "Alldone Gold" — no subscription route', () => {
        const tree = renderCard()
        const titles = tree.root.findAllByType('MockButton').map(node => node.props.title)

        expect(titles).toContain('Personal API key')
        expect(titles).toContain('Alldone Gold')
        expect(titles).not.toContain('Subscription')
        expect(titles).not.toContain('Connect subscription')
        expect(JSON.stringify(tree.toJSON())).not.toContain('Subscription authentication')
    })

    // The card was previously unreachable, so this pins the whole add path, not just the button.
    test('validates and saves a pasted OpenRouter key against the openrouter provider slot', async () => {
        const tree = renderCard()
        const input = tree.root
            .findAllByType(TextInput)
            .find(node => node.props.placeholder === 'Paste your OpenRouter API key (sk-or-…)')
        expect(input.props.secureTextEntry).toBe(true)

        await act(async () => {
            input.props.onChangeText('sk-or-v1-0123456789abcdef0123456789abcdef')
        })
        await act(async () => {
            await tree.root
                .findAllByType('MockButton')
                .find(node => node.props.title === 'Validate and save key')
                .props.onPress()
        })

        // 'openrouter', NOT 'codex': the harness is Codex but the key is OpenRouter's.
        expect(saveVmApiKey).toHaveBeenCalledWith({
            provider: 'openrouter',
            apiKey: 'sk-or-v1-0123456789abcdef0123456789abcdef',
        })
        expect(input.props.value).toBe('')
    })

    test('switches an OpenRouter run between the personal key and Alldone Gold, and removes the key', async () => {
        const tree = renderCard({ activeMode: 'byok', apiKey: { connected: true, validationStatus: 'valid' } })
        const button = title => tree.root.findAllByType('MockButton').find(node => node.props.title === title)

        await act(async () => {
            await button('Alldone Gold').props.onPress()
        })
        expect(setVmCredentialMode).toHaveBeenCalledWith({ provider: 'openrouter', mode: 'api' })

        await act(async () => {
            await button('Remove key').props.onPress()
        })
        expect(removeVmApiKey).toHaveBeenCalledWith({ provider: 'openrouter' })
    })

    test('never renders a saved OpenRouter key, and surfaces a rejected one', () => {
        const rawKey = 'sk-or-v1-secret-that-must-not-render'
        const tree = renderCard({
            activeMode: 'byok',
            apiKey: { connected: true, validationStatus: 'invalid', rawKey },
        })
        const output = JSON.stringify(tree.toJSON())

        expect(output).not.toContain(rawKey)
        expect(output).toContain('Saved key was rejected — replace or remove it')
        expect(output).toContain('Using your personal API key')
    })

    test('a connected subscription on another provider cannot mark OpenRouter as subscription-billed', () => {
        // `connected: true` is what the backend reports for the codex/claude cards. Even if it
        // leaked into this card's props, OpenRouter has no subscription route to fall into.
        const tree = renderCard({ connected: true, activeMode: 'api', apiKey: { connected: false } })
        const output = JSON.stringify(tree.toJSON())

        expect(output).toContain('Using Alldone API billing')
        expect(output).not.toContain('Using your subscription')
    })
})
