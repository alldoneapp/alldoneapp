import React from 'react'
import Comment from '../../../components/TaskDetailedView/CommentsView/Comment'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('Comment component', () => {
    const testComment = {
        commenterPhotoURL: 'somewhere',
        date: new Date(),
        comment: 'asd',
        attachments: [{ name: 'fileName', downloadURL: 'https://' }],
    }
    describe('Comment snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Comment comment={testComment} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Comment methods', () => {
        it('parse correctly the relative dates', () => {
            const tree = renderer.create(<Comment comment={testComment} />)
            const instance = tree.getInstance()
            let parsed = instance.parseRelativeDate(new Date())
            expect(parsed).toEqual('Just now')
        })

        it('parse correctly the relative dates - diff days', () => {
            const tree = renderer.create(<Comment comment={testComment} />)
            const instance = tree.getInstance()
            let parsed = instance.parseRelativeDate(new Date('2020-04-05 00:00'))
            expect(parsed).toEqual('More than a day ago')
        })

        it('parse correctly the relative dates - diff 3m', () => {
            const tree = renderer.create(<Comment comment={testComment} />)
            const instance = tree.getInstance()
            const pastDate = new Date()
            pastDate.setMinutes(pastDate.getMinutes() - 3)
            let parsed = instance.parseRelativeDate(pastDate)
            expect(parsed).toEqual('3 minutes ago')
        })

        it('parse correctly the relative dates - diff 2h', () => {
            const tree = renderer.create(<Comment comment={testComment} />)
            const instance = tree.getInstance()
            const pastDate = new Date()
            pastDate.setHours(pastDate.getHours() - 2)
            let parsed = instance.parseRelativeDate(pastDate)
            expect(parsed).toEqual('2 hours ago')
        })

        it('parse correctly the relative dates - diff 1h', () => {
            const tree = renderer.create(<Comment comment={testComment}/>)
            const instance = tree.getInstance()
            const pastDate = new Date()
            pastDate.setHours(pastDate.getHours() - 1)
            let parsed = instance.parseRelativeDate(pastDate)
            expect(parsed).toEqual('1 hour ago')
        })
    })
})
