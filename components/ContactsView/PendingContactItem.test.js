/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import PendingContactItem from './PendingContactItem'
import Spinner from '../UIComponents/Spinner'

/**
 * AT-2508 — the pixels of the "this person is being added" row.
 *
 * Geometry is the point as much as the text: this row is replaced by the real `ContactItem` a
 * beat later, and if the two are not the same size the whole list jumps under the cursor at the
 * exact moment the user is looking at it. `ContactItem.js`'s `localStyles` is the source of
 * truth for these numbers, the same contract `ContactsListSkeleton.test.js` pins.
 */

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))

const render = element => {
    let tree
    act(() => {
        tree = renderer.create(element)
    })
    return tree
}

const contact = (extra = {}) => ({ uid: 'new-1', displayName: 'David Massanek', ...extra })

describe('PendingContactItem', () => {
    it('shows the name the user typed', () => {
        const tree = render(<PendingContactItem contact={contact()} />)

        expect(JSON.stringify(tree.toJSON())).toContain('David Massanek')
    })

    it('says what is happening', () => {
        const tree = render(<PendingContactItem contact={contact()} />)

        expect(JSON.stringify(tree.toJSON())).toContain('Adding person...')
    })

    it('spins, so the row reads as in-progress rather than broken', () => {
        const tree = render(<PendingContactItem contact={contact()} />)

        expect(tree.root.findAllByType(Spinner)).toHaveLength(1)
    })

    it('announces itself as progress to assistive technology', () => {
        const tree = render(<PendingContactItem contact={contact()} />)

        const row = tree.root.findByProps({ testID: 'pending-contact-row' }, { deep: false })
        expect(row.props.accessibilityRole).toBe('progressbar')
        expect(row.props.accessibilityLabel).toBe('Adding person: David Massanek')
    })

    it('keeps ContactItem geometry, so the real row can replace it without moving the page', () => {
        const tree = render(<PendingContactItem contact={contact()} />)
        const row = tree.root.findByProps({ testID: 'pending-contact-row' }, { deep: false })

        const style = Object.assign({}, ...[].concat(row.props.style))
        expect(style.paddingTop).toBe(8)
        expect(style.paddingBottom).toBe(10)
        expect(style.marginLeft).toBe(-8)
        expect(style.marginRight).toBe(-8)

        // 90px main row + 8 + 10 = the 108px a settled contact row occupies.
        const mainRow = tree.root.findByProps({ testID: 'pending-contact-main-row' }, { deep: false })
        const mainRowStyle = Object.assign({}, ...[].concat(mainRow.props.style))
        expect(mainRowStyle.height).toBe(90)
    })

    it('is inert — nothing to press, swipe or open on a contact that does not exist yet', () => {
        const tree = render(<PendingContactItem contact={contact()} />)
        const json = JSON.stringify(tree.toJSON())

        expect(json).not.toContain('onClick')
        expect(tree.root.findAllByProps({ accessibilityRole: 'button' }, { deep: false })).toHaveLength(0)
    })

    it('renders without a name rather than throwing', () => {
        expect(() => render(<PendingContactItem contact={{ uid: 'new-1' }} />)).not.toThrow()
        expect(() => render(<PendingContactItem />)).not.toThrow()
    })
})
