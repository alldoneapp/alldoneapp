/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastCommentRollCard from './LastCommentRollCard'
import { resetLastCommentSlotRows } from './lastCommentSlotRow'
import { ProjectSectionLastCommentTintContext } from '../../../TaskListView/TaskHierarchy'
import { colors } from '../../../styles/global'

jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => true,
}))

const renderCard = ({ compact = false, projectLastCommentTint } = {}) => {
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
        projectLastCommentTint ? (
            <ProjectSectionLastCommentTintContext.Provider value={projectLastCommentTint}>
                {card}
            </ProjectSectionLastCommentTintContext.Provider>
        ) : (
            card
        )
    )
}

const backgroundColorOf = tree => StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).backgroundColor

describe('LastCommentRollCard project context background (AT-2537)', () => {
    beforeEach(() => resetLastCommentSlotRows())

    it('uses the darker project tint when rendered below a project line', () => {
        const projectLastCommentTint = '#F7DEE3'
        const tree = renderCard({ projectLastCommentTint })

        expect(backgroundColorOf(tree)).toBe(projectLastCommentTint)
        act(() => tree.unmount())
    })

    it('keeps the neutral background outside project context', () => {
        const tree = renderCard()

        expect(backgroundColorOf(tree)).toBe(colors.Grey300)
        act(() => tree.unmount())
    })

    it('also applies the darker project tint to the compact latest-comment line', () => {
        const projectLastCommentTint = '#F7DEE3'
        const tree = renderCard({ compact: true, projectLastCommentTint })

        expect(backgroundColorOf(tree)).toBe(projectLastCommentTint)
        act(() => tree.unmount())
    })
})
