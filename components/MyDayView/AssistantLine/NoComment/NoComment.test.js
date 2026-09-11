import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import NoComment from './NoComment'
import { ProjectSectionLastCommentTintContext } from '../../../TaskListView/TaskHierarchy'
import { colors } from '../../../styles/global'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ selectedProjectIndex: 0 }),
}))
jest.mock('../../../../utils/assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: () => false,
}))
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../LastComment/ProjectTagIndicator', () => 'ProjectTagIndicator')

const backgroundColorOf = tree => StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).backgroundColor

describe('NoComment project context background (AT-2537)', () => {
    it('uses the darker project tint below a project line', () => {
        const projectLastCommentTint = '#F7DEE3'
        const tree = renderer.create(
            <ProjectSectionLastCommentTintContext.Provider value={projectLastCommentTint}>
                <NoComment projectId="project-1" assistant={{ uid: 'assistant-1' }} />
            </ProjectSectionLastCommentTintContext.Provider>
        )

        expect(backgroundColorOf(tree)).toBe(projectLastCommentTint)
        act(() => tree.unmount())
    })

    it('keeps the neutral background in All Projects', () => {
        const tree = renderer.create(<NoComment projectId="project-1" assistant={{ uid: 'assistant-1' }} />)

        expect(backgroundColorOf(tree)).toBe(colors.Grey300)
        act(() => tree.unmount())
    })
})
