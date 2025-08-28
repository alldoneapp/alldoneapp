import React from 'react'
import SocialTextInput from '../components/SocialTextInput'
import renderer from 'react-test-renderer'

jest.mock('react-native-web-webview')
jest.mock('firebase', () => ({ firestore: {} }));

describe('SocialTextInput component', () => {
    describe('SocialTextInput snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SocialTextInput />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
