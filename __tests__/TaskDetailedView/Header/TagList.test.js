/**
 * @jest-environment jsdom
 */

import React from 'react'
import TagList from '../../../components/TaskDetailedView/Header/TagList'

import renderer from 'react-test-renderer'

describe('TagList component', () => {
    describe('TagList snapshot test', () => {
        xit('should render correctly', () => {
            const tree = renderer
                .create(
                    <TagList projectId={'0'} task={{ isPrivate: true, recurrence: { type: 'never' } }} />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function toggleVisibility snapshots test', () => {
        xit('Should execute and render correctly', () => {
            const tree = renderer.create(
                <TagList projectId={'0'} task={{ isPrivate: true, recurrence: { type: 'never' } }} />
            )

            tree.getInstance().toggleVisibility()
            let state = tree.getInstance().state
            expect(state.isPrivate).toBeFalsy()
        })
    })
})
