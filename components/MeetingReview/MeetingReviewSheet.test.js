import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))
jest.mock('../../hooks/useEscapeKey', () => jest.fn())

import useEscapeKey from '../../hooks/useEscapeKey'
import MeetingReviewSheet from './MeetingReviewSheet'
import { resolveMeetingCategory } from '../../functions/shared/meetingReview/meetingCategorySuggestion'

const START = Date.UTC(2026, 10, 24, 8, 30)
const task = (extra = {}) => ({
    id: 'evt',
    name: 'Weekly Sync Produkt',
    done: true,
    calendarData: { recurringEventId: 'series-1', startMs: START, endMs: START + 3600000, attendeeCount: 8 },
    ...extra,
})

const render = (props = {}) => {
    const onAction = jest.fn()
    const onLater = jest.fn()
    const t = props.task || task()
    let tree
    act(() => {
        tree = renderer.create(
            <MeetingReviewSheet
                task={t}
                review={props.review || null}
                resolved={props.resolved || resolveMeetingCategory({ task: t, review: props.review })}
                seriesCategory={props.seriesCategory || null}
                isEdit={props.isEdit}
                nowMs={props.nowMs || START + 2 * 3600000}
                onAction={onAction}
                onLater={onLater}
            />
        )
    })
    return {
        tree,
        onAction,
        onLater,
        byId: id => tree.root.findByProps({ testID: id }),
        all: id => tree.root.findAllByProps({ testID: id }),
    }
}

describe('MeetingReviewSheet', () => {
    it('W1: one tap on a usefulness button rates; the preselected category is confirmed by the save path', () => {
        const { byId, onAction } = render()
        expect(byId('meeting-category-selected')).toBeTruthy()
        act(() => byId('meeting-usefulness-not_helpful').props.onPress())
        expect(onAction).toHaveBeenCalledWith(
            { type: 'rate', usefulness: 'not_helpful', category: undefined },
            { scope: null, duration: null }
        )
    })

    it('never preselects a usefulness', () => {
        const { tree } = render()
        const buttons = tree.root.findAll(
            node => /^meeting-usefulness-/.test(node.props.testID || '') && node.props.accessibilityRole
        )
        buttons.forEach(button => {
            const flat = [].concat(button.props.style).filter(Boolean)
            expect(flat.some(style => style && style.borderColor && style.borderColor !== 'transparent')).toBe(false)
        })
    })

    it('W2: correcting the category of a series asks "series from now / only this one" (series by default)', () => {
        const { byId, onAction } = render()
        act(() => byId('meeting-category-selected').props.onPress())
        act(() => byId('meeting-category-work').props.onPress())
        expect(byId('meeting-series-scope')).toBeTruthy()
        expect(byId('meeting-scope-series').props.accessibilityState.checked).toBe(true)
        act(() => byId('meeting-scope-instance').props.onPress())
        act(() => byId('meeting-usefulness-worthwhile').props.onPress())
        expect(onAction).toHaveBeenCalledWith(
            { type: 'rate', usefulness: 'worthwhile', category: 'work' },
            { scope: 'instance', duration: null }
        )
    })

    it('W3: with low confidence nothing is preselected and the two likely categories are highlighted', () => {
        const t = task({
            name: 'Abstimmung Q1 Planning',
            calendarData: { startMs: START, endMs: START + 3600000, attendeeCount: 4 },
        })
        const { all, byId, onAction } = render({ task: t })
        expect(all('meeting-category-selected')).toHaveLength(0)
        expect(byId('meeting-category-list')).toBeTruthy()
        expect(byId('meeting-suggestion-label').props.children).toBe(
            'Meeting suggestion please choose · Meeting suggestion source signals'
        )
        act(() => byId('meeting-usefulness-partly').props.onPress())
        expect(onAction.mock.calls[0][0]).toEqual({ type: 'rate', usefulness: 'partly', category: undefined })
    })

    it('"Why?" shows only the real calendar signals', () => {
        const { byId } = render()
        act(() => byId('meeting-why').props.onPress())
        const text = byId('meeting-why-text').props.children
        expect(text).toContain('Meeting signal title word')
        expect(text).toContain('Meeting signal recurring')
        expect(text).toContain('{"count":8}')
    })

    it('"Later", ×, and Escape leave it unrated', () => {
        const { byId, onLater } = render()
        act(() => byId('meeting-review-later').props.onPress())
        act(() => byId('meeting-review-close').props.onPress())
        const escapeHandler = useEscapeKey.mock.calls[useEscapeKey.mock.calls.length - 1][0]
        act(() => escapeHandler())
        expect(onLater).toHaveBeenCalledTimes(3)
    })

    it('W4: a shorter duration travels with the rating; "not attended" asks no usefulness', () => {
        const { byId, onAction } = render()
        act(() => byId('meeting-duration-toggle').props.onPress())
        act(() => byId('meeting-duration-end-15').props.onPress())
        act(() => byId('meeting-usefulness-partly').props.onPress())
        expect(onAction.mock.calls[0][1].duration).toEqual({ actualStartMs: START, actualEndMs: START + 45 * 60000 })

        act(() => byId('meeting-not-attended').props.onPress())
        expect(onAction.mock.calls[1][0]).toEqual({ type: 'not_attended' })
    })

    it('keyboard 1/2/3 rates', () => {
        const { onAction } = render()
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))
        })
        expect(onAction.mock.calls[0][0]).toMatchObject({ type: 'rate', usefulness: 'not_helpful' })
    })

    it('E5: rating before the planned end shows a hint', () => {
        const { all } = render({ nowMs: START + 10 * 60000 })
        expect(all('meeting-review-ends-later')).toHaveLength(1)
    })

    it('editing later offers "remove rating" for a rated appointment', () => {
        const review = { reviewStatus: 'rated', usefulness: 'partly', category: 'status', categorySource: 'user' }
        const { byId, onAction } = render({ review, isEdit: true })
        act(() => byId('meeting-review-clear').props.onPress())
        expect(onAction).toHaveBeenCalledWith({ type: 'clear' }, { close: true })
    })
    describe('AT-3147: five categories', () => {
        const textOf = node =>
            node
                .findAll(child => typeof child.props.children === 'string')
                .map(child => child.props.children)
                .join(' ')
        const insight = task({
            name: 'AI Insight Session #8: AI Pricing',
            calendarData: { startMs: START, endMs: START + 3600000, attendeeCount: 0 },
        })

        it('lists exactly work, status & stakeholder, learning, network & sales and own time', () => {
            const { all, byId } = render({
                task: task({ name: 'Termin', calendarData: { startMs: START, endMs: START + 3600000 } }),
            })
            expect(byId('meeting-category-list')).toBeTruthy()
            const keys = all('meeting-category-list')[0]
                .findAll(node => typeof node.props.testID === 'string' && /^meeting-category-/.test(node.props.testID))
                .filter(node => node.props.onPress)
                .map(node => node.props.testID.replace('meeting-category-', ''))
            expect([...new Set(keys)]).toEqual(['work', 'status', 'learning', 'network', 'own_time'])
            expect(all('meeting-category-stakeholder')).toHaveLength(0)
        })

        it('preselects learning for "AI Insight Session #8: AI Pricing" instead of own time; one tap confirms it', () => {
            const { byId, onAction } = render({
                task: insight,
                review: {
                    aiSuggestion: { category: 'own_time', confidence: 'medium', signals: ['keine Teilnehmenden'] },
                },
            })
            const selected = byId('meeting-category-selected')
            expect(textOf(selected)).toContain('Meeting category learning')
            act(() => byId('meeting-usefulness-worthwhile').props.onPress())
            expect(onAction).toHaveBeenCalledWith(
                { type: 'rate', usefulness: 'worthwhile', category: undefined },
                { scope: null, duration: null }
            )
        })

        it('shows a rating saved as "stakeholder" as "Status & Stakeholder" when editing it', () => {
            const t = task({
                name: 'Steering',
                calendarData: { startMs: START, endMs: START + 3600000, attendeeCount: 5 },
            })
            const review = {
                category: 'stakeholder',
                categorySource: 'user',
                usefulness: 'partly',
                reviewStatus: 'rated',
            }
            const { byId } = render({ task: t, review, isEdit: true })
            expect(textOf(byId('meeting-category-selected'))).toContain('Meeting category status')
        })
    })
})
