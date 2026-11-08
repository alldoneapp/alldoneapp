import React from 'react'
import renderer, { act } from 'react-test-renderer'

import AssistantMemoryPanel from './AssistantMemoryPanel'
import { getAssistantMemory, updateAssistantMemory } from '../../utils/backends/firestore'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle1: {}, subtitle2: {}, body2: {}, caption1: {} },
    colors: {
        Text01: '#111',
        Text02: '#222',
        Text03: '#777',
        Grey300: '#ddd',
        Primary100: '#00f',
        UtilityRed200: '#f00',
    },
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../UIControls/Switch', () => {
    const React = require('react')
    const { TouchableOpacity } = require('react-native')
    return function MockSwitch({ active, activeSwitch, deactiveSwitch }) {
        return <TouchableOpacity testID="assistant-memory-share" onPress={active ? deactiveSwitch : activeSwitch} />
    }
})
jest.mock('../../utils/backends/firestore', () => ({
    getAssistantMemory: jest.fn(),
    updateAssistantMemory: jest.fn(),
}))

const flush = () => act(async () => {})

async function render(props) {
    let tree
    await act(async () => {
        tree = renderer.create(<AssistantMemoryPanel projectId="p1" {...props} />)
    })
    await flush()
    return tree
}

const press = async (tree, testID) => {
    await act(async () => {
        tree.root.findByProps({ testID }).props.onPress()
    })
    await flush()
}

const textOf = tree => JSON.stringify(tree.toJSON())

describe('AssistantMemoryPanel', () => {
    beforeEach(() => jest.clearAllMocks())

    test('the owner sees the private memory and can share it read-only', async () => {
        getAssistantMemory.mockResolvedValue({
            isOwner: true,
            visible: true,
            content: '2026-03-11: Prefers short summaries',
            shareWithProjectMembers: false,
        })
        updateAssistantMemory.mockResolvedValue({
            isOwner: true,
            visible: true,
            content: '2026-03-11: Prefers short summaries',
            shareWithProjectMembers: true,
        })

        const tree = await render({ userId: 'u1', loggedUserId: 'u1' })
        expect(getAssistantMemory).toHaveBeenCalledWith('p1', 'u1')
        await press(tree, 'assistant-memory-toggle')
        expect(tree.root.findByProps({ testID: 'assistant-memory-content' }).props.children).toBe(
            '2026-03-11: Prefers short summaries'
        )

        await press(tree, 'assistant-memory-share')
        expect(updateAssistantMemory).toHaveBeenCalledWith('p1', { shareWithProjectMembers: true })
        expect(textOf(tree)).toContain('Project members can see this memory, read-only.')
    })

    test('the owner edits the memory through the callable', async () => {
        getAssistantMemory.mockResolvedValue({
            isOwner: true,
            visible: true,
            content: 'old',
            shareWithProjectMembers: false,
        })
        updateAssistantMemory.mockResolvedValue({
            isOwner: true,
            visible: true,
            content: 'new',
            shareWithProjectMembers: false,
        })

        const tree = await render({ userId: 'u1', loggedUserId: 'u1' })
        await press(tree, 'assistant-memory-toggle')
        await press(tree, 'assistant-memory-edit')
        await act(async () => {
            tree.root.findByProps({ testID: 'assistant-memory-input' }).props.onChangeText('new')
        })
        await press(tree, 'assistant-memory-save')

        expect(updateAssistantMemory).toHaveBeenCalledWith('p1', { content: 'new' })
        expect(tree.root.findByProps({ testID: 'assistant-memory-content' }).props.children).toBe('new')
    })

    test('a teammate sees a shared memory without any edit controls', async () => {
        getAssistantMemory.mockResolvedValue({
            isOwner: false,
            visible: true,
            content: 'shared fact',
            shareWithProjectMembers: true,
        })

        const tree = await render({ userId: 'owner', loggedUserId: 'teammate' })
        await press(tree, 'assistant-memory-toggle')

        expect(tree.root.findByProps({ testID: 'assistant-memory-content' }).props.children).toBe('shared fact')
        expect(tree.root.findAllByProps({ testID: 'assistant-memory-edit' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'assistant-memory-share' })).toHaveLength(0)
    })

    test('a teammate sees nothing while the memory is private, and no load error either', async () => {
        getAssistantMemory.mockResolvedValue({ isOwner: false, visible: false, content: '' })
        const tree = await render({ userId: 'owner', loggedUserId: 'teammate' })
        expect(tree.toJSON()).toBeNull()

        getAssistantMemory.mockRejectedValue(new Error('permission-denied'))
        const failed = await render({ userId: 'owner', loggedUserId: 'teammate' })
        expect(failed.toJSON()).toBeNull()
    })
})
