/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import renderer from 'react-test-renderer'

import LastAssistantComment, {
    LAST_COMMENT_PREVIEW_HEIGHT,
    PREVIEW_BODY_HEIGHT,
    PREVIEW_TITLE_HEIGHT,
} from './LastAssistantComment'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector => selector({ selectedProjectIndex: 0, loggedUser: { uid: 'user-1' } }),
}))

jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: () => false,
}))

jest.mock('./ProjectTagIndicator', () => () => null)
jest.mock('./UnreadCommentsBadge', () => () => null)

const SHORT_TEXT = 'Ok'
const LONG_TEXT = 'Some rather long assistant answer that definitely wraps over several lines. '.repeat(10)

const renderPreview = (commentText, extraProps = {}) =>
    renderer.create(
        <LastAssistantComment
            projectId={'project-1'}
            commentText={commentText}
            objectName={'A chat title'}
            onPress={() => {}}
            {...extraProps}
        />
    )

const getCardStyle = tree => StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

const getFixedHeightViewHeights = tree =>
    tree.root
        .findAllByType(View)
        .map(node => StyleSheet.flatten(node.props.style))
        .map(style => style?.height)
        .filter(height => height != null)

describe('LastAssistantComment preview height (AT-2344)', () => {
    it('reserves the same card height for a short and a long comment', () => {
        const shortCard = getCardStyle(renderPreview(SHORT_TEXT))
        const longCard = getCardStyle(renderPreview(LONG_TEXT))

        expect(shortCard.height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
        expect(longCard.height).toBe(LAST_COMMENT_PREVIEW_HEIGHT)
        expect(shortCard.height).toBe(longCard.height)
    })

    it('does not size the card with a minHeight/maxHeight range any more', () => {
        const cardStyle = getCardStyle(renderPreview(SHORT_TEXT))

        expect(cardStyle.minHeight).toBeUndefined()
        expect(cardStyle.maxHeight).toBeUndefined()
    })

    it('keeps the card height equal to its reserved title + body + padding layout', () => {
        const heights = getFixedHeightViewHeights(renderPreview(LONG_TEXT))

        expect(heights).toContain(PREVIEW_TITLE_HEIGHT)
        expect(heights).toContain(PREVIEW_BODY_HEIGHT)
        expect(LAST_COMMENT_PREVIEW_HEIGHT).toBe(PREVIEW_TITLE_HEIGHT + PREVIEW_BODY_HEIGHT + 12 * 2)
    })

    it('still reserves the title row when the chat has no title', () => {
        const withTitle = getCardStyle(renderPreview(SHORT_TEXT, { objectName: 'A chat title' }))
        const withoutTitle = getCardStyle(renderPreview(SHORT_TEXT, { objectName: '' }))

        expect(withoutTitle.height).toBe(withTitle.height)
        expect(getFixedHeightViewHeights(renderPreview(SHORT_TEXT, { objectName: '' }))).toContain(PREVIEW_TITLE_HEIGHT)
    })

    it('keeps the compact variant at its own fixed height', () => {
        const shortCompact = getCardStyle(renderPreview(SHORT_TEXT, { compact: true }))
        const longCompact = getCardStyle(renderPreview(LONG_TEXT, { compact: true }))

        expect(shortCompact.height).toBe(24)
        expect(longCompact.height).toBe(24)
    })
})
