import React from 'react'
import { Text } from 'react-native'
import { Provider } from 'react-redux'
import store from '../redux/store'

// SocialTextInput wraps the Quill editor, whose refs never resolve against
// react-test-renderer's virtual tree; this suite covers the wrapper.
jest.mock('../components/Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')

// The Dismissible from replacement_node_modules attaches listeners to a DOM
// node from a ref, which react-test-renderer never provides.
jest.mock('react-dismissible', () => ({ Dismissible: ({ children }) => children || null }))
import SocialTextInput from '../components/SocialTextInput'
import SocialText from '../components/UIControls/SocialText/SocialText'
import renderer from 'react-test-renderer'

jest.mock('react-native-web-webview')

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

    // AT-2341: the task DV heading passes its type chip (the "Email" chip) down this way, so the
    // chip ends up inside SocialText's wrapping text flow instead of occupying its own column
    // beside the title.
    describe('leftCustomElement forwarding', () => {
        it('forwards leftCustomElement to SocialText', () => {
            const chip = <Text>Email</Text>
            const tree = renderer.create(
                <Provider store={store}>
                    <SocialTextInput
                        task={{ id: 'task-1', name: 'My task' }}
                        value="My task"
                        leftCustomElement={chip}
                    />
                </Provider>
            )

            expect(tree.root.findByType(SocialText).props.leftCustomElement).toBe(chip)
        })
    })
})
