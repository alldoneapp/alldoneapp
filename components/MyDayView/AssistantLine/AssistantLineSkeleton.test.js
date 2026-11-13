/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import renderer from 'react-test-renderer'

import AssistantLineSkeleton, { LastCommentPreviewSkeleton } from './AssistantLineSkeleton'
import {
    ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT,
    ASSISTANT_HEADER_GAP,
    ASSISTANT_HEADER_HEIGHT,
} from './assistantInputLayout'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './LastComment/lastCommentLayout'
import { ProjectSectionLastCommentTintContext } from '../../TaskListView/TaskHierarchy'
import { colors } from '../../styles/global'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ smallScreenNavigation: true }) }))

describe('AssistantLineSkeleton', () => {
    it('reserves the real assistant-line geometry: header, two-line composer box, last comment', () => {
        const tree = renderer.create(<AssistantLineSkeleton />)
        const styles = tree.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style))

        expect(styles).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ height: ASSISTANT_HEADER_HEIGHT, marginBottom: ASSISTANT_HEADER_GAP }),
                expect.objectContaining({ height: ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT }),
                expect.objectContaining({ height: LAST_COMMENT_PREVIEW_HEIGHT }),
            ])
        )
        // 1px border + 8 padding + 56 field (two lines) + 4 gap + 36 toolbar + 6 padding + 1px border.
        expect(ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT).toBe(112)
    })

    // AT-3034 follow-up: while the assistant-mode sidebar is open the line is only its Last comment.
    it('drops the header and composer ghosts for the Last-comment-only line', () => {
        const tree = renderer.create(<AssistantLineSkeleton lastCommentOnly />)
        const styles = tree.root.findAllByType(View).map(node => StyleSheet.flatten(node.props.style) || {})

        expect(styles.some(style => style.height === ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT)).toBe(false)
        expect(styles.some(style => style.height === ASSISTANT_HEADER_HEIGHT)).toBe(false)
        expect(tree.root.findAllByProps({ testID: 'assistant-last-comment-loading-skeleton' }).length).toBeGreaterThan(
            0
        )
    })

    it('uses the same fixed height as the real last-comment preview', () => {
        const tree = renderer.create(<LastCommentPreviewSkeleton />)
        const card = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-last-comment-loading-skeleton' }).props.style
        )

        expect(card.height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
    })

    it('uses the darker project tint for the loading preview in project context', () => {
        const projectLastCommentTint = '#F7DEE3'
        const tree = renderer.create(
            <ProjectSectionLastCommentTintContext.Provider value={projectLastCommentTint}>
                <LastCommentPreviewSkeleton />
            </ProjectSectionLastCommentTintContext.Provider>
        )
        const card = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-last-comment-loading-skeleton' }).props.style
        )

        expect(card.backgroundColor).toBe(projectLastCommentTint)
    })

    it('keeps the neutral loading preview outside project context', () => {
        const tree = renderer.create(<LastCommentPreviewSkeleton />)
        const card = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-last-comment-loading-skeleton' }).props.style
        )

        expect(card.backgroundColor).toBe(colors.Grey300)
    })
})
