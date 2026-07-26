/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { Platform } from 'react-native'
import MentionsModal from '../../../components/Feeds/CommentsTextInput/MentionsModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useDispatch: jest.fn(() => () => {}),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            projectsUsers: [
                [
                    { uid: 0, displayName: 'pepe' },
                    { uid: 1, displayName: 'pedro' },
                    { uid: 2, displayName: 'pero' },
                    { uid: 3, displayName: 'pepe' },
                ],
            ],
            selectedProjectIndex: 0,
            // The modal tracks which nested picker is on top now.
            mentionModalStack: [],
        })
    }),
}))
jest.mock('../../../components/MyPlatform', () => ({
    isMobile: false,
}))

describe('MentionsModal component', () => {
    it('should render correctly', () => {
        const tree = renderer.create(
            <Provider store={store}>
                <MentionsModal mentionText="pe" projectIndex={0} />
            </Provider>
        )
        tree.update(<MentionsModal mentionText="juan" />)
        expect(tree.toJSON()).toMatchSnapshot()
    })
})
