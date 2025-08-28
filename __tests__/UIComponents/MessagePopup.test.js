import React from 'react'
import MessagePopup from '../../components/UIComponents/MessagePopup'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('MessagePopup component', () => {
    describe('MessagePopup snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<MessagePopup />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function hidePopup snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(<MessagePopup />)

            tree.getInstance().hidePopup()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
