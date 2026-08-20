import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ContactsListSkeleton from './ContactsListSkeleton'

jest.mock('../../i18n/TranslationService', () => ({
    translate: value => value,
}))

const render = async element => {
    let tree
    await act(async () => {
        tree = renderer.create(element)
        await Promise.resolve()
    })
    return tree
}

describe('ContactsListSkeleton', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
    })

    it('renders one ghost per requested row and announces itself as busy', async () => {
        const tree = await render(<ContactsListSkeleton rowCount={4} contactKeys={['a', 'b', 'c', 'd']} />)

        expect(tree.root.findAllByProps({ testID: 'contact-loading-skeleton-row' })).toHaveLength(4)
        expect(tree.root.findByProps({ testID: 'contacts-list-loading-skeleton' }).props.accessibilityRole).toBe(
            'progressbar'
        )
    })

    it('falls back to three rows when the caller cannot size the batch', async () => {
        const tree = await render(<ContactsListSkeleton />)
        expect(tree.root.findAllByProps({ testID: 'contact-loading-skeleton-row' })).toHaveLength(3)
    })

    it('renders nothing rather than crashing on a non-positive row count', async () => {
        const tree = await render(<ContactsListSkeleton rowCount={0} />)
        expect(tree.root.findAllByProps({ testID: 'contact-loading-skeleton-row' })).toHaveLength(0)
    })

    it('matches the real ContactItem row height so arriving contacts do not shift the list', async () => {
        const tree = await render(<ContactsListSkeleton rowCount={1} />)
        const row = tree.root.findByProps({ testID: 'contact-loading-skeleton-row' })
        const { paddingTop, paddingBottom, marginLeft, marginRight } = row.props.style

        // ContactItem: paddingTop 8 + mainRow 90 + paddingBottom 10 = a 108px row, bled -8
        // horizontally. The ghost has to add up to the same numbers or every expansion
        // nudges the page as the real rows land.
        expect(paddingTop).toBe(8)
        expect(paddingBottom).toBe(10)
        expect(marginLeft).toBe(-8)
        expect(marginRight).toBe(-8)

        const mainRow = tree.root.findByProps({ testID: 'contact-loading-skeleton-main-row' })
        expect(mainRow.props.style.height).toBe(90)
    })

    it('drops the shimmer sweep when the user prefers reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        const reduced = await render(<ContactsListSkeleton rowCount={1} />)

        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        const normalMotion = await render(<ContactsListSkeleton rowCount={1} />)

        const countSweeps = tree =>
            tree.root.findAll(node => node.props?.pointerEvents === 'none', { deep: true }).length

        expect(countSweeps(reduced)).toBe(0)
        expect(countSweeps(normalMotion)).toBeGreaterThan(0)
    })
})
