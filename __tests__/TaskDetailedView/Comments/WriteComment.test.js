/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import WriteComment from '../../../components/TaskDetailedView/CommentsView/WriteComment'

import renderer from 'react-test-renderer'

describe('WriteComment component', () => {
    describe('WriteComment snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<WriteComment />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('WriteComment methods', () => {
        it('should change the comment text', () => {
            const tree = renderer.create(<WriteComment />)
            const instance = tree.getInstance()
            instance.onChangeText('asd')
            expect(instance.state.commentText).toEqual('asd')
        })

        it('should reset things when on blur', () => {
            const tree = renderer.create(<WriteComment />)
            const instance = tree.getInstance()
            instance.onBlur()
            expect(instance.state.height._value).toEqual(42)
        })

        it('should react properly to multiline content changes', () => {
            const tree = renderer.create(<WriteComment />)
            const instance = tree.getInstance()
            instance.onContentSizeChange({ nativeEvent: { contentSize: { height: 42 } } })
            expect(instance.state.height._value).toEqual(42)
        })

        it('should open the select file dialog on press attachment', () => {
            const tree = renderer.create(<WriteComment />)
            const instance = tree.getInstance()
            instance.onPressAttachment()
            const input = document.getElementsByTagName('input')
            expect(input).toBeTruthy()
        })
    })
})
