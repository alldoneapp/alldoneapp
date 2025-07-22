import React from 'react'
import CommentsHeader from '../../../components/TaskDetailedView/CommentsView/CommentsHeader'

import renderer from 'react-test-renderer'

describe('CommentsHeader component', () => {
    describe('CommentsHeader snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CommentsHeader commentAmount={10} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('CommentsHeader methods', () => {
        it('should correctly parse the amount of comments', () => {
            let tree = renderer.create(<CommentsHeader commentAmount={10} />)
            let instance = tree.getInstance()
            let amountText = instance.parseCommentAmount()
            expect(amountText).toEqual('10 Entries')

            tree = renderer.create(<CommentsHeader commentAmount={1} />)
            instance = tree.getInstance()
            amountText = instance.parseCommentAmount()
            expect(amountText).toEqual('1 Entry')
        })
    })
})
