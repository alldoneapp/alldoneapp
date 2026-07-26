import React from 'react'
import { Platform } from 'react-native'
import AttachmentsTag from '../../components/FollowUp/AttachmentsTag'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('AttachmentsTag component', () => {
    describe('AttachmentsTag snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<AttachmentsTag text="some text" removeTag={true} ico="x" imageUrl="https://asdas" />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly', () => {
            const tree = renderer
                .create(<AttachmentsTag text="some text" removeTag={false} ico="x" imageUrl="" />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
