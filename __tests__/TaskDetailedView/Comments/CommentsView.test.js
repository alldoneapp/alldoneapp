import React from 'react'
import CommentsView from '../../../components/TaskDetailedView/CommentsView/CommentsView'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('CommentsView component', () => {
    describe('CommentsView snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CommentsView />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('CommentsView methods', () => {
        it('update the state with the new comments', () => {
            const tree = renderer.create(<CommentsView />)
            const instance = tree.getInstance()
            instance.onCommentsChange([
                {
                    commenterId: '0',
                    commenterPhotoURL: 'https://goingInsideTheBlackHole.forever',
                    date: Date.now(),
                    attachments: [],
                },
                {
                    commenterId: '1',
                    commenterPhotoURL: 'https://goingInsideTheBlackHole.again',
                    date: Date.now(),
                    attachments: [],
                },
            ])

            expect(instance.state.comments.length).toEqual(2)
        })
    })
})
