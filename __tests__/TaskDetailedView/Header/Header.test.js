/**
 * @jest-environment jsdom
 */

import React from 'react'
import Header from '../../../components/TaskDetailedView/Header/Header'

import renderer from 'react-test-renderer'

describe('Header component', () => {
    describe('Header snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Header
                        projectId={'-Asd'}
                        task={{ name: 'test', isPrivate: false, recurrence: { type: 'never' } }}
                    />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
