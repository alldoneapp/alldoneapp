/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import renderer from 'react-test-renderer'

import AssistantLineSkeleton, {
    ASSISTANT_OPTIONS_FIRST_ROW_HEIGHT,
    ASSISTANT_OPTIONS_HEADER_HEIGHT,
    ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT,
    LastCommentPreviewSkeleton,
} from './AssistantLineSkeleton'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './LastComment/lastCommentLayout'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ smallScreenNavigation: true }) }))

describe('AssistantLineSkeleton', () => {
    it('reserves the measured mobile assistant-line content height', () => {
        const tree = renderer.create(<AssistantLineSkeleton />)
        const styles = tree.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style))

        expect(styles).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ height: ASSISTANT_OPTIONS_FIRST_ROW_HEIGHT }),
                expect.objectContaining({ height: ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT }),
                expect.objectContaining({ height: LAST_COMMENT_PREVIEW_HEIGHT }),
            ])
        )
        expect(
            ASSISTANT_OPTIONS_HEADER_HEIGHT +
                16 +
                ASSISTANT_OPTIONS_FIRST_ROW_HEIGHT +
                12 +
                ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT +
                24 +
                16 +
                8 +
                LAST_COMMENT_PREVIEW_HEIGHT
        ).toBe(305)
    })

    it('uses the same fixed height as the real last-comment preview', () => {
        const tree = renderer.create(<LastCommentPreviewSkeleton />)
        const card = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-last-comment-loading-skeleton' }).props.style
        )

        expect(card.height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
    })
})
