/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform, Text, TouchableOpacity } from 'react-native'
import ProjectTag from '../../components/Tags/ProjectTag'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('../../redux/actions', () => ({ setShowAllProjectsByTime: jest.fn() }))
jest.mock('../../utils/backends/Users/usersFirestore', () => ({ updateShowAllProjectsByTime: jest.fn() }))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectById: jest.fn() }))
jest.mock('../../URLSystem/URLTrigger', () => ({ processUrl: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({}))

import renderer from 'react-test-renderer'

const dummyProject = { id: '-Asd', color: '#fff000', name: 'Project X' }

describe('Project tag component', () => {
    describe('Project tag snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<ProjectTag project={dummyProject} style={{ marginHorizontal: 16 }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    it('keeps the full project name as the accessible label when the visible text is shortened', () => {
        const tree = renderer.create(<ProjectTag project={dummyProject} shrinkTextToAmountOfLetter={8} />)

        expect(tree.root.findByType(Text).props.children).toBe('Project ...')
        expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe(dummyProject.name)
    })
})
