import React from 'react'
import AttachmentsTag from '../../components/FollowUp/AttachmentsTag'
import renderer from 'react-test-renderer'

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
