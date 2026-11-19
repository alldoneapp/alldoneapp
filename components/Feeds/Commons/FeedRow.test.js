import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet, Text } from 'react-native'

import FeedRow from './FeedRow'
import NewFeedDot from '../FollowSwitchableTag/NewFeedDot'
import { ProjectSectionContext, taskHierarchyStyles } from '../../TaskListView/TaskHierarchy'
import { FOLLOWED_TAB } from '../Utils/FeedsConstants'

// AT-3103: in Updates the unread dot sat half (or fully) outside the project card's left edge,
// because every feed entry was pulled 16px left into a gutter the card does not have.

function rowStyle(element) {
    let tree
    act(() => {
        tree = renderer.create(element)
    })
    const style = StyleSheet.flatten(tree.root.findByProps({ testID: 'feed-row' }).props.style) || {}
    act(() => tree.unmount())
    return style
}

function dotStyle(isMiddleScreen) {
    let tree
    act(() => {
        tree = renderer.create(<NewFeedDot feedActiveTab={FOLLOWED_TAB} isMiddleScreen={isMiddleScreen} />)
    })
    const style = StyleSheet.flatten(tree.root.findByProps({ testID: 'new-feed-dot' }).props.style)
    act(() => tree.unmount())
    return style
}

const inProjectCard = (isFirst = true) => (
    <ProjectSectionContext.Provider value={true}>
        <FeedRow isFirst={isFirst}>
            <Text>entry</Text>
        </FeedRow>
    </ProjectSectionContext.Provider>
)

describe('FeedRow', () => {
    it('keeps the dot slot inside a project card (Updates page)', () => {
        expect(rowStyle(inProjectCard()).marginLeft).toBeUndefined()
    })

    it('still pulls the entry into the page gutter outside a project card (detailed view Updates tab)', () => {
        expect(
            rowStyle(
                <FeedRow isFirst>
                    <Text>entry</Text>
                </FeedRow>
            ).marginLeft
        ).toBe(-16)
    })

    it('spaces every entry but the first', () => {
        expect(rowStyle(inProjectCard(true)).marginTop).toBeUndefined()
        expect(rowStyle(inProjectCard(false)).marginTop).toBe(8)
    })
})

describe('NewFeedDot inside an Updates project card', () => {
    // Feed types give their entry `marginLeft: 16` while read and, while unread, 0 (6 on middle
    // screens) and let the dot fill the rest. The card body pads its content by `projectBody`.
    const cardPadding = taskHierarchyStyles.projectBody.paddingHorizontal
    const cases = [
        { name: 'wide screen', isMiddleScreen: false, entryMargin: 0 },
        { name: 'middle/mobile screen', isMiddleScreen: true, entryMargin: 6 },
    ]

    it.each(cases)(
        'sits fully inside the card, 12-16px from its left edge ($name)',
        ({ isMiddleScreen, entryMargin }) => {
            const dot = dotStyle(isMiddleScreen)
            const leftFromCardEdge = cardPadding + entryMargin + (dot.marginLeft || 0)
            expect(leftFromCardEdge).toBeGreaterThanOrEqual(12)
            expect(leftFromCardEdge).toBeLessThanOrEqual(16)
        }
    )

    it.each(cases)(
        'fills exactly the 16px slot so read and unread times line up ($name)',
        ({ isMiddleScreen, entryMargin }) => {
            const dot = dotStyle(isMiddleScreen)
            expect(entryMargin + (dot.marginLeft || 0) + dot.width + (dot.marginRight || 0)).toBe(16)
        }
    )
})
