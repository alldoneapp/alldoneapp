/**
 * @jest-environment jsdom
 */

import React from 'react'
import AddContact from '../../components/ContactsView/AddContact'
import renderer from 'react-test-renderer'

describe('AddContact component', () => {
    describe('AddContact snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<AddContact />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
