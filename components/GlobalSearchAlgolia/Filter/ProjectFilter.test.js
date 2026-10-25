import React from 'react'
import { StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'

const mockState = {
    loggedUser: { photoURL: 'https://example.com/me.png' },
    smallScreenNavigation: false,
    isMiddleScreen: false,
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('react-hot-keys', () => 'Hotkeys')
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall', () => 'ColoredCircleSmall')
jest.mock('../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch', () => ({
    ALL_PROJECTS_OPTION: 'all-projects',
}))
jest.mock('../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants', () => ({
    isAutomaticProjectOption: () => false,
}))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

import ProjectFilter from './ProjectFilter'

describe('ProjectFilter add-task layout (AT-2580)', () => {
    it('keeps the label and responsive project pill grouped on the left', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <ProjectFilter
                    selectedProject={{ id: 'project-1', name: 'A project with a very long name' }}
                    setShowSelectProjectModal={jest.fn()}
                    text="Select project"
                />
            )
        })

        expect(StyleSheet.flatten(tree.root.findByProps({ testID: 'project-filter' }).props.style)).toMatchObject({
            paddingHorizontal: 16,
        })
        expect(
            StyleSheet.flatten(tree.root.findByProps({ testID: 'project-filter-content' }).props.style)
        ).toMatchObject({
            minWidth: 0,
            justifyContent: 'flex-start',
        })
        expect(StyleSheet.flatten(tree.root.findByProps({ testID: 'project-filter-label' }).props.style)).toMatchObject(
            {
                flexShrink: 0,
                marginRight: 16,
            }
        )
        expect(StyleSheet.flatten(tree.root.findByProps({ testID: 'project-filter-scope' }).props.style)).toMatchObject(
            {
                minWidth: 0,
                flexShrink: 1,
            }
        )
        expect(StyleSheet.flatten(tree.root.findByProps({ testID: 'project-scope-tag' }).props.style)).toMatchObject({
            minWidth: 0,
            maxWidth: '100%',
            flexShrink: 1,
        })
        expect(tree.root.findByProps({ testID: 'project-scope-tag-name' }).props.numberOfLines).toBe(1)
    })
})
