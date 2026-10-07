import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'

import AssistantProgress, {
    getAssistantProgressKind,
    getAssistantProgressToolLabel,
    getAssistantProgressDetail,
    ACTION_EMOJI,
} from './AssistantProgress'
import { colors } from '../../../styles/global'
import en from '../../../../i18n/translations/en.json'

// Mirrors i18n-js: returns the key when there is nothing to interpolate (so the existing
// assertions keep reading as keys) and appends the interpolated values otherwise.
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, interpolations = {}) => {
        const values = Object.values(interpolations || {})
        return values.length ? `${key}|${values.join(',')}` : key
    },
}))

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

    test.each([
        ['web_search', 'Search the internet'],
        ['get_note', 'Get notes'],
        ['talk_to_assistant_project_helper_123', 'Talk to assistants'],
        ['external_tool_calendar_123', 'Use external app tools'],
        ['mcp_drive_123', 'Use connected MCP servers'],
        ['custom_data_helper', 'Custom data helper'],
    ])('shows a friendly label for the %s tool', (toolName, expectedLabel) => {
        expect(getAssistantProgressToolLabel(toolName)).toBe(expectedLabel)
    })

    test('waits for real activity changes without manufacturing a history on a timer', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantProgress activity={{ phase: 'preparing', startedAt: 1 }} />)
        })
        act(() => jest.advanceTimersByTime(60000))
        expect(renderedText(tree)).toContain('assistant_progress_preparing_1')
        expect(renderedText(tree)).not.toContain('assistant_progress_preparing_2')
        expect(tree.root.findAllByProps({ testID: 'assistant-progress-step-text' })).toHaveLength(1)
        expect(renderedText(tree)).not.toContain('assistant_progress_reassurance')
        act(() => tree.unmount())
    })

    test('retains real phase transitions and replaces history when a new run starts', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantProgress runId="one" activity={{ phase: 'thinking', startedAt: 1 }} />)
        })
        act(() =>
            tree.update(
                <AssistantProgress runId="one" activity={{ phase: 'tool', toolName: 'web_search', startedAt: 2 }} />
            )
        )
        expect(renderedText(tree)).toContain('assistant_progress_thinking_1')
        expect(renderedText(tree)).toContain('Search the internet')
        expect(tree.root.findAllByProps({ testID: 'assistant-progress-previous' })).toHaveLength(1)
        act(() => tree.update(<AssistantProgress runId="two" activity={{ phase: 'preparing', startedAt: 3 }} />))
        expect(renderedText(tree)).not.toContain('Search the internet')
        expect(tree.root.findAllByProps({ testID: 'assistant-progress-previous' })).toHaveLength(0)
        act(() => tree.unmount())
    })

    test('restores persisted history and catches up on events missed between snapshots', () => {
        const first = { phase: 'thinking', startedAt: 1 }
        const tool = { phase: 'tool', toolName: 'web_search', startedAt: 2 }
        const composing = { phase: 'composing', startedAt: 3 }
        let tree
        act(() => {
            tree = renderer.create(<AssistantProgress activity={tool} activityHistory={[first, tool]} />)
        })
        expect(tree.root.findAllByProps({ testID: 'assistant-progress-step-text' })).toHaveLength(2)
        act(() => tree.update(<AssistantProgress activity={composing} activityHistory={[first, tool, composing]} />))
        expect(tree.root.findAllByProps({ testID: 'assistant-progress-step-text' })).toHaveLength(3)
        expect(renderedText(tree)).toContain('assistant_progress_composing_1')
        act(() => tree.unmount())
    })

    test('uses a dark popup surface with high-contrast progress colors', () => {
        const tree = renderer.create(
            <AssistantProgress activity={{ phase: 'preparing', startedAt: 1 }} compact={true} appearance="dark" />
        )
        const containerStyle = StyleSheet.flatten(tree.root.findByProps({ testID: 'assistant-progress' }).props.style)
        const currentTextStyle = StyleSheet.flatten(
            tree.root.findAllByProps({ testID: 'assistant-progress-step-text' })[0].props.style
        )

        expect(containerStyle).toEqual(
            expect.objectContaining({ backgroundColor: colors.Secondary300, borderColor: colors.Secondary200 })
        )
        expect(currentTextStyle.color).toBe('#FFFFFF')
        expect(tree.root.findByType(ActivityIndicator).props.color).toBe(colors.UtilityBlue200)
    })

    test('shows a friendly tool label without a reassurance footer', () => {
        const tree = renderer.create(
            <AssistantProgress activity={{ phase: 'tool', toolName: 'web_search', startedAt: 1 }} appearance="dark" />
        )
        expect(renderedText(tree)).toContain('Search the internet')
        expect(renderedText(tree)).not.toContain('web_search')
        expect(tree.root.findAllByProps({ testID: 'assistant-progress-reassurance' })).toHaveLength(0)
    })

    describe('specific activity detail', () => {
        const searchingNotes = {
            phase: 'tool',
            toolName: 'search',
            startedAt: 1,
            actionKey: 'assistant_activity_search_notes',
            subject: 'Pricing',
        }

        test('replaces the generic line with what is actually happening', () => {
            const tree = renderer.create(<AssistantProgress activity={searchingNotes} />)
            const text = renderedText(tree)

            expect(text).toContain('assistant_activity_search_notes|Pricing')
            expect(text).not.toContain('assistant_progress_workspace_1')
        })

        test('keeps the specific line pinned instead of rotating it away', () => {
            let tree
            act(() => {
                tree = renderer.create(<AssistantProgress activity={searchingNotes} />)
            })

            act(() => jest.advanceTimersByTime(60000))

            expect(renderedText(tree)).toContain('assistant_activity_search_notes|Pricing')
            expect(tree.root.findAllByProps({ testID: 'assistant-progress-step-text' })).toHaveLength(1)
        })

        test('renders a subject-less action without an empty placeholder', () => {
            const tree = renderer.create(
                <AssistantProgress
                    activity={{
                        phase: 'tool',
                        toolName: 'get_notes',
                        startedAt: 1,
                        actionKey: 'assistant_activity_read_notes',
                        subject: null,
                    }}
                />
            )

            expect(renderedText(tree)).toContain('assistant_activity_read_notes')
            expect(renderedText(tree)).not.toContain('|')
        })

        test('updates one combined progress line for a batch of tool calls', () => {
            let tree
            const activity = {
                phase: 'tool',
                toolName: 'parallel_reads',
                startedAt: 1,
                actionKey: 'assistant_activity_multiple_steps',
                subject: '0/5',
            }
            act(() => {
                tree = renderer.create(<AssistantProgress activity={activity} />)
            })
            expect(renderedText(tree)).toContain('assistant_activity_multiple_steps|0/5')
            act(() => {
                tree.update(<AssistantProgress activity={{ ...activity, subject: '2/5' }} />)
            })
            expect(renderedText(tree)).toContain('assistant_activity_multiple_steps|2/5')
            expect(renderedText(tree)).not.toContain('0/5')
            expect(tree.root.findAllByProps({ testID: 'assistant-progress-step-text' })).toHaveLength(1)
            act(() => tree.unmount())
        })

        test.each([
            ['an unknown key', { actionKey: 'assistant_activity_not_shipped_yet', subject: 'x' }],
            ['no key at all', { actionKey: null, subject: null }],
        ])('falls back to the friendly tool label given %s', (_label, overrides) => {
            const tree = renderer.create(
                <AssistantProgress activity={{ phase: 'tool', toolName: 'get_notes', startedAt: 1, ...overrides }} />
            )

            expect(renderedText(tree)).toContain('Get notes')
        })

        test('ignores a detail that arrives on a non-tool phase', () => {
            expect(
                getAssistantProgressDetail({
                    phase: 'thinking',
                    actionKey: 'assistant_activity_search_notes',
                    subject: 'x',
                })
            ).toBeNull()
        })

        test('truncates an over-long subject so the row stays on one line', () => {
            const subject = 'x'.repeat(200)
            const detail = getAssistantProgressDetail({
                phase: 'tool',
                actionKey: 'assistant_activity_search_notes',
                subject,
            })

            expect(detail.text.length).toBeLessThan(120)
            expect(detail.text.endsWith('…')).toBe(true)
        })

        test('every shipped activity key has an emoji and an English phrase', () => {
            const translationKeys = Object.keys(en).filter(key => key.startsWith('assistant_activity_'))
            const emojiKeys = Object.keys(ACTION_EMOJI)

            expect(translationKeys.length).toBeGreaterThan(40)
            expect(emojiKeys.filter(key => !translationKeys.includes(key))).toEqual([])
            expect(translationKeys.filter(key => !emojiKeys.includes(key))).toEqual([])
        })
    })
})
