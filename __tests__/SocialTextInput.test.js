import React from 'react'
import { Provider } from 'react-redux'
import store from '../redux/store'

// SocialTextInput wraps the Quill editor, whose refs never resolve against
// react-test-renderer's virtual tree; this suite covers the wrapper.
jest.mock('../components/Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')
import SocialTextInput from '../components/SocialTextInput'
import renderer from 'react-test-renderer'

jest.mock('react-native-web-webview')
jest.mock('firebase', () => ({ firestore: {} }))

describe('SocialTextInput component', () => {
    describe('SocialTextInput snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <SocialTextInput task={{ id: 'task-1', name: 'My task' }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
