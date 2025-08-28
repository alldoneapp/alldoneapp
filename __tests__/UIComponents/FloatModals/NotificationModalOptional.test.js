import React from 'react'
import renderer from 'react-test-renderer'

import NotificationModalOptional from '../../../components/UIComponents/FloatModals/NotificationModalOptional'

jest.mock('firebase', () => ({ firestore: {} }))

describe('NotificationModalOptional component', () => {
    describe('NotificationModalOptional snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<NotificationModalOptional />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
