/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastCommentRollCard from './LastCommentRollCard'
import { resetLastCommentSlotRows } from './lastCommentSlotRow'
import { ProjectSectionAccentContext } from '../../../TaskListView/TaskHierarchy'
import { colors } from '../../../styles/global'

jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => true,
}))

const renderCard = ({ compact = false, projectAccentColor } = {}) => {
    const card = (
        <LastCommentRollCard
            projectId="project-1"
            commentText="Latest comment"
            objectName="Project chat"
            rowKind="preview"
            compact={compact}
        >
            <Text>Latest comment</Text>
        </LastCommentRollCard>
    )

    return renderer.create(
        projectAccentColor ? (
            <ProjectSectionAccentContext.Provider value={projectAccentColor}>
                {card}
            </ProjectSectionAccentContext.Provider>
        ) : (
            card
        )
    )
}

const backgroundColorOf = tree => StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).backgroundColor

describe('LastCommentRollCard project context background (AT-2537)', () => {
    beforeEach(() => resetLastCommentSlotRows())

    it('uses the milestone accent when rendered below a project line', () => {
        const projectAccentColor = '#FAEBEE'
        const tree = renderCard({ projectAccentColor })

        expect(backgroundColorOf(tree)).toBe(projectAccentColor)
        act(() => tree.unmount())
    })

    it('keeps the neutral background outside project context', () => {
        const tree = renderCard()

        expect(backgroundColorOf(tree)).toBe(colors.Grey300)
        act(() => tree.unmount())
    })

    it('also applies the project accent to the compact latest-comment line', () => {
        const projectAccentColor = '#FAEBEE'
        const tree = renderCard({ compact: true, projectAccentColor })

        expect(backgroundColorOf(tree)).toBe(projectAccentColor)
        act(() => tree.unmount())
    })
})
