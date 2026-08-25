import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import NotesListSkeleton from './NotesListSkeleton'

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

describe('NotesListSkeleton', () => {
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
        const tree = await render(<NotesListSkeleton rowCount={4} noteKeys={['a', 'b', 'c', 'd']} />)

        expect(tree.root.findAllByProps({ testID: 'note-loading-skeleton-row' })).toHaveLength(4)
        expect(tree.root.findByProps({ testID: 'notes-list-loading-skeleton' }).props.accessibilityRole).toBe(
            'progressbar'
        )
    })

    it('matches the real NotesItem row height so arriving notes do not shift the list', async () => {
        const tree = await render(<NotesListSkeleton rowCount={1} />)
        const row = tree.root.findByProps({ testID: 'note-loading-skeleton-row' })
        const { paddingTop, paddingBottom } = row.props.style

        // NotesItem declares maxHeight 92 = 8 padding + 24 title + 32 preview + 20 meta + 8.
        // The ghost has to add up to the same number or every expansion nudges the page.
        expect(paddingTop + paddingBottom).toBe(16)
    })

    it('can reserve the real project-header height for progressive loading', async () => {
        const tree = await render(<NotesListSkeleton rowCount={3} showProjectHeader />)
        const header = tree.root.findByProps({ testID: 'notes-project-loading-skeleton-header' })

        expect(header.props.style.height).toBe(56)
        expect(tree.root.findByProps({ testID: 'notes-project-loading-skeleton-leading-edge' })).toBeTruthy()
        expect(tree.root.findAllByProps({ testID: 'note-loading-skeleton-row' })).toHaveLength(3)
    })

    it('drops the shimmer sweep when the user prefers reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const reduced = await render(<NotesListSkeleton rowCount={1} />)
        const normalMotion = await (async () => {
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
            return render(<NotesListSkeleton rowCount={1} />)
        })()

        const countSweeps = tree =>
            tree.root.findAll(node => node.props?.pointerEvents === 'none', { deep: true }).length

        expect(countSweeps(reduced)).toBe(0)
        expect(countSweeps(normalMotion)).toBeGreaterThan(0)
    })
})
