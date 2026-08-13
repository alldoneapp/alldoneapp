import React from 'react'
import renderer, { act } from 'react-test-renderer'

import DefaultVmAgentSection from './DefaultVmAgentSection'
import { getVmAgentSettings, setDefaultVmAgent, setDefaultVmAgentModel } from '../../../utils/backends/firestore'

jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { subtitle1: {}, subtitle2: {}, body2: {}, caption1: {}, title6: {} },
    colors: {
        Text01: '#111',
        Text02: '#222',
        Text03: '#777',
        Grey300: '#ddd',
        Gray400: '#ccc',
        Primary100: '#00f',
        UtilityBlue100: '#eef',
        UtilityRed200: '#f00',
    },
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../../../utils/backends/firestore', () => ({
    getVmAgentSettings: jest.fn(),
    setDefaultVmAgent: jest.fn(async () => ({})),
    setDefaultVmAgentModel: jest.fn(async () => ({})),
    setDefaultVmAgentReasoningEffort: jest.fn(async () => ({})),
    setDefaultVmApprovalPolicy: jest.fn(async () => ({})),
}))

const CATALOGS = {
    claude: {
        families: [
            { id: 'opus', label: 'Opus', resolvedModel: 'opus', isAlias: true },
            { id: 'sonnet', label: 'Sonnet', resolvedModel: 'sonnet', isAlias: true },
            { id: 'haiku', label: 'Haiku', resolvedModel: 'haiku', isAlias: true },
        ],
        source: 'live',
    },
    codex: {
        families: [
            { id: 'sol', label: 'Sol', resolvedModel: 'gpt-5.6-sol', isAlias: false },
            { id: 'terra', label: 'Terra', resolvedModel: 'gpt-5.6-terra', isAlias: false },
            { id: 'luna', label: 'Luna', resolvedModel: 'gpt-5.6-luna', isAlias: false },
        ],
        source: 'live',
    },
}

function settingsPayload(overrides = {}) {
    return {
        effectiveDefaultAgent: 'codex',
        effectiveDefaultReasoningEffort: 'medium',
        effectiveDefaultApprovalPolicy: 'balanced',
        defaultModelFamilies: { claude: null, codex: null },
        modelCatalogs: CATALOGS,
        ...overrides,
    }
}

async function renderSection() {
    let tree
    await act(async () => {
        tree = renderer.create(<DefaultVmAgentSection />)
    })
    return tree
}

// Option pills are the only TouchableOpacity-with-text nodes in this section.
function optionLabels(tree) {
    return tree.root
        .findAll(node => node.props.accessibilityRole === 'radio')
        .map(node => {
            const text = node.findAll(child => typeof child.props.children === 'string')
            return text.length ? text[0].props.children : ''
        })
}

function pressOption(tree, label) {
    const option = tree.root
        .findAll(node => node.props.accessibilityRole === 'radio')
        .find(node => node.findAll(child => child.props.children === label).length > 0)
    if (!option) throw new Error(`No option labelled "${label}"`)
    return option.props.onPress
}

beforeEach(() => {
    jest.clearAllMocks()
    getVmAgentSettings.mockResolvedValue(settingsPayload())
})

describe('DefaultVmAgentSection model family picker', () => {
    it('shows the families of the selected agent, not the other agent', async () => {
        const tree = await renderSection()
        const labels = optionLabels(tree)

        // Default agent is codex → Codex tiers are offered, Claude tiers are not.
        expect(labels).toEqual(expect.arrayContaining(['Sol', 'Terra', 'Luna']))
        expect(labels).not.toEqual(expect.arrayContaining(['Opus']))
    })

    it('swaps the family list when the agent changes', async () => {
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'Claude')()
        })

        const labels = optionLabels(tree)
        expect(labels).toEqual(expect.arrayContaining(['Opus', 'Sonnet', 'Haiku']))
        expect(labels).not.toEqual(expect.arrayContaining(['Sol']))
        expect(setDefaultVmAgent).toHaveBeenCalledWith('claude')
    })

    it('saves the family against the agent it belongs to', async () => {
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'Terra')()
        })

        expect(setDefaultVmAgentModel).toHaveBeenCalledWith('codex', 'terra')
    })

    it('keeps each agent’s own choice when switching back and forth', async () => {
        getVmAgentSettings.mockResolvedValue(
            settingsPayload({ defaultModelFamilies: { claude: 'sonnet', codex: 'luna' } })
        )
        const tree = await renderSection()

        const selectedLabel = () =>
            tree.root
                .findAll(node => node.props.accessibilityRole === 'radio')
                .filter(node => node.props.accessibilityState.selected)
                .map(node => {
                    const text = node.findAll(child => typeof child.props.children === 'string')
                    return text.length ? text[0].props.children : ''
                })

        expect(selectedLabel()).toContain('Luna')

        await act(async () => {
            await pressOption(tree, 'Claude')()
        })
        expect(selectedLabel()).toContain('Sonnet')
        // Switching agents must not write a model preference.
        expect(setDefaultVmAgentModel).not.toHaveBeenCalled()
    })

    it('offers a "No default" option that clears an existing preference', async () => {
        getVmAgentSettings.mockResolvedValue(
            settingsPayload({ defaultModelFamilies: { claude: null, codex: 'terra' } })
        )
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'No default')()
        })

        expect(setDefaultVmAgentModel).toHaveBeenCalledWith('codex', null)
    })

    it('does not re-save a family that is already selected', async () => {
        getVmAgentSettings.mockResolvedValue(
            settingsPayload({ defaultModelFamilies: { claude: null, codex: 'terra' } })
        )
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'Terra')()
        })

        expect(setDefaultVmAgentModel).not.toHaveBeenCalled()
    })

    it('rolls the selection back and surfaces an error when the save fails', async () => {
        setDefaultVmAgentModel.mockRejectedValueOnce(new Error('nope'))
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'Sol')()
        })

        const selected = tree.root
            .findAll(node => node.props.accessibilityRole === 'radio')
            .filter(node => node.props.accessibilityState.selected)
            .map(node => node.findAll(child => typeof child.props.children === 'string')[0].props.children)
        expect(selected).toContain('No default')
        expect(selected).not.toContain('Sol')
    })

    it('still renders a usable picker when the provider could not be reached', async () => {
        getVmAgentSettings.mockResolvedValue(
            settingsPayload({
                modelCatalogs: {
                    claude: { families: CATALOGS.claude.families, source: 'fallback' },
                    codex: { families: CATALOGS.codex.families, source: 'fallback' },
                },
            })
        )
        const tree = await renderSection()

        expect(optionLabels(tree)).toEqual(expect.arrayContaining(['Sol', 'Terra', 'Luna']))
        const rendered = JSON.stringify(tree.toJSON())
        expect(rendered).toContain('Could not reach the model provider')
    })

    it('degrades to just the "No default" option when no catalog is returned at all', async () => {
        getVmAgentSettings.mockResolvedValue(settingsPayload({ modelCatalogs: null }))
        const tree = await renderSection()

        expect(optionLabels(tree)).toEqual(expect.arrayContaining(['No default']))
        expect(optionLabels(tree)).not.toEqual(expect.arrayContaining(['Sol']))
    })
})

// AT-2230: Codex can also run tool-calling OpenRouter models (DeepSeek and friends). The source
// toggle only changes what the list shows — it never saves on its own.
const OPENROUTER_CATALOG = {
    families: [
        {
            id: 'openrouter:deepseek/deepseek-chat',
            label: 'DeepSeek Chat',
            vendor: 'deepseek',
            modelId: 'deepseek/deepseek-chat',
            resolvedModel: 'openrouter:deepseek/deepseek-chat',
        },
        {
            id: 'openrouter:qwen/qwen3-max',
            label: 'Qwen3 Max',
            vendor: 'qwen',
            modelId: 'qwen/qwen3-max',
            resolvedModel: 'openrouter:qwen/qwen3-max',
        },
    ],
    searchModels: [
        {
            id: 'openrouter:deepseek/deepseek-chat',
            label: 'DeepSeek Chat',
            vendor: 'deepseek',
            modelId: 'deepseek/deepseek-chat',
            resolvedModel: 'openrouter:deepseek/deepseek-chat',
        },
        {
            id: 'openrouter:qwen/qwen3-max',
            label: 'Qwen3 Max',
            vendor: 'qwen',
            modelId: 'qwen/qwen3-max',
            resolvedModel: 'openrouter:qwen/qwen3-max',
        },
        {
            id: 'openrouter:x-ai/grok-4.6',
            label: 'SpaceXAI: Grok 4.6',
            vendor: 'x-ai',
            modelId: 'x-ai/grok-4.6',
            resolvedModel: 'openrouter:x-ai/grok-4.6',
        },
        {
            id: 'openrouter:someone/niche-model',
            label: 'Someone: Niche Model',
            vendor: 'someone',
            modelId: 'someone/niche-model',
            resolvedModel: 'openrouter:someone/niche-model',
        },
    ],
    source: 'live',
    available: true,
}

const withOpenRouter = (overrides = {}) =>
    settingsPayload({ modelCatalogs: { ...CATALOGS, openrouter: OPENROUTER_CATALOG }, ...overrides })

describe('DefaultVmAgentSection OpenRouter source (AT-2230)', () => {
    it('offers the source toggle for Codex and shows OpenAI models first', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter())
        const tree = await renderSection()
        const labels = optionLabels(tree)

        expect(labels).toEqual(expect.arrayContaining(['OpenAI', 'OpenRouter']))
        expect(labels).toEqual(expect.arrayContaining(['Sol', 'Terra', 'Luna']))
        expect(labels).not.toEqual(expect.arrayContaining(['DeepSeek Chat']))
    })

    it('swaps the model list to OpenRouter without saving anything', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter())
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'OpenRouter')()
        })

        const labels = optionLabels(tree)
        expect(labels).toEqual(expect.arrayContaining(['DeepSeek Chat', 'Qwen3 Max']))
        expect(labels).not.toEqual(expect.arrayContaining(['Sol']))
        expect(setDefaultVmAgentModel).not.toHaveBeenCalled()
        expect(JSON.stringify(tree.toJSON())).toContain('Featured models')
    })

    it('searches every compatible OpenRouter model, not only the featured set', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter())
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'OpenRouter')()
        })
        expect(optionLabels(tree)).not.toContain('SpaceXAI: Grok 4.6')

        const search = tree.root.findByProps({ testID: 'openrouter-model-search' })
        await act(async () => {
            search.props.onChangeText('grok 4.6')
        })

        expect(optionLabels(tree)).toContain('SpaceXAI: Grok 4.6')
        expect(optionLabels(tree)).not.toContain('DeepSeek Chat')
        expect(JSON.stringify(tree.toJSON())).toContain('Search results')
    })

    it('saves a model selected from search', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter())
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'OpenRouter')()
        })
        await act(async () => {
            tree.root.findByProps({ testID: 'openrouter-model-search' }).props.onChangeText('grok')
        })
        await act(async () => {
            await pressOption(tree, 'SpaceXAI: Grok 4.6')()
        })

        expect(setDefaultVmAgentModel).toHaveBeenCalledWith('codex', 'openrouter:x-ai/grok-4.6')
    })

    it('keeps a saved non-featured model visible beside the featured choices', async () => {
        getVmAgentSettings.mockResolvedValue(
            withOpenRouter({ defaultModelFamilies: { claude: null, codex: 'openrouter:someone/niche-model' } })
        )
        const tree = await renderSection()

        expect(optionLabels(tree)).toContain('Someone: Niche Model')
        expect(optionLabels(tree)).toContain('DeepSeek Chat')
    })

    it('shows an empty state when no compatible model matches', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter())
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'OpenRouter')()
        })
        await act(async () => {
            tree.root.findByProps({ testID: 'openrouter-model-search' }).props.onChangeText('not-a-real-model')
        })

        expect(JSON.stringify(tree.toJSON())).toContain('No compatible models match your search.')
    })

    it('saves the prefixed selection so the run knows which upstream to use', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter())
        const tree = await renderSection()

        await act(async () => {
            await pressOption(tree, 'OpenRouter')()
        })
        await act(async () => {
            await pressOption(tree, 'DeepSeek Chat')()
        })

        expect(setDefaultVmAgentModel).toHaveBeenCalledWith('codex', 'openrouter:deepseek/deepseek-chat')
    })

    // Returning to an OpenAI list would make a saved DeepSeek default look lost.
    it('opens on the OpenRouter list when that is what the user saved', async () => {
        getVmAgentSettings.mockResolvedValue(
            withOpenRouter({ defaultModelFamilies: { claude: null, codex: 'openrouter:deepseek/deepseek-chat' } })
        )
        const tree = await renderSection()

        expect(optionLabels(tree)).toEqual(expect.arrayContaining(['DeepSeek Chat']))
    })

    it('hides the toggle for Claude, which cannot run an OpenRouter model', async () => {
        getVmAgentSettings.mockResolvedValue(withOpenRouter({ effectiveDefaultAgent: 'claude' }))
        const tree = await renderSection()

        expect(optionLabels(tree)).not.toEqual(expect.arrayContaining(['OpenRouter']))
    })

    // Offering a model whose run would fail closed is worse than not offering it at all.
    it('hides the toggle when the environment cannot reach OpenRouter', async () => {
        getVmAgentSettings.mockResolvedValue(
            withOpenRouter({
                modelCatalogs: { ...CATALOGS, openrouter: { ...OPENROUTER_CATALOG, available: false } },
            })
        )
        const tree = await renderSection()

        expect(optionLabels(tree)).not.toEqual(expect.arrayContaining(['OpenRouter']))
    })

    it('is completely absent for a backend that returns no OpenRouter catalog at all', async () => {
        getVmAgentSettings.mockResolvedValue(settingsPayload())
        const tree = await renderSection()

        expect(optionLabels(tree)).not.toEqual(expect.arrayContaining(['OpenRouter']))
        expect(optionLabels(tree)).toEqual(expect.arrayContaining(['Sol']))
    })
})
