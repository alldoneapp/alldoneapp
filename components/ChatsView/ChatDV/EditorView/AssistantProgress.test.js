import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import AssistantProgress, { ASSISTANT_PROGRESS_ROTATION_MS, getAssistantProgressKind } from './AssistantProgress'

jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))

const renderedText = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .flat(Infinity)
        .filter(value => typeof value === 'string')
        .join('\n')

describe('AssistantProgress', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    test.each([
        [{ phase: 'preparing' }, 'preparing'],
        [{ phase: 'thinking' }, 'thinking'],
        [{ phase: 'tool', toolName: 'web_search' }, 'web'],
        [{ phase: 'tool', toolName: 'get_notes' }, 'workspace'],
        [{ phase: 'tool', toolName: 'search_gmail' }, 'communication'],
        [{ phase: 'tool', toolName: 'update_note' }, 'change'],
        [{ phase: 'tool', toolName: 'execute_task_in_vm' }, 'specialist'],
        [{ phase: 'tool', toolName: 'something_new' }, 'tool'],
        [{ phase: 'composing' }, 'composing'],
    ])('maps an activity to %s', (activity, expectedKind) => {
        expect(getAssistantProgressKind(activity)).toBe(expectedKind)
    })

    test('builds a visible activity trail as the wait continues', () => {
        const tree = renderer.create(<AssistantProgress activity={{ phase: 'preparing', startedAt: 1 }} />)

        expect(renderedText(tree)).toContain('assistant_progress_preparing_1')
        expect(renderedText(tree)).not.toContain('assistant_progress_preparing_2')

        act(() => {
            jest.advanceTimersByTime(ASSISTANT_PROGRESS_ROTATION_MS * 2)
        })

        expect(renderedText(tree)).toContain('assistant_progress_preparing_1')
        expect(renderedText(tree)).toContain('assistant_progress_preparing_2')
        expect(renderedText(tree)).toContain('assistant_progress_preparing_3')
    })

    test('resets the story when the backend moves to a real tool phase', () => {
        const tree = renderer.create(<AssistantProgress activity={{ phase: 'thinking', startedAt: 1 }} />)
        act(() => jest.advanceTimersByTime(ASSISTANT_PROGRESS_ROTATION_MS * 2))

        act(() => {
            tree.update(<AssistantProgress activity={{ phase: 'tool', toolName: 'web_search', startedAt: 2 }} />)
        })

        expect(renderedText(tree)).toContain('assistant_progress_web_1')
        expect(renderedText(tree)).not.toContain('assistant_progress_web_2')
    })
})
