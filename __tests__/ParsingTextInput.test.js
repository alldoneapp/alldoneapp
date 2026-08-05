import React from 'react'
import ParsingTextInput from '../components/ParsingTextInput'
import renderer from 'react-test-renderer'
import MyPlatform from '../components/MyPlatform'
import { nodeMockOptions } from '../testUtils/domNodeStub'

jest.mock('react-native-web-webview')
jest.mock('firebase', () => ({ firestore: {} }))

describe('ParsingTextInput component', () => {
    describe('ParsingTextInput snapshot test', () => {
        it('should render correctly', () => {
            MyPlatform.getElementWidth = jest.fn(x => 5)
            const tree = renderer
                .create(
                    <ParsingTextInput value="Sample @mention #hashtag a@gmail.com http://link.com" />,
                    nodeMockOptions
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
