import React from 'react'
import Privacy from '../../../components/TaskDetailedView/Properties/Privacy'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('Privacy component', () => {
    describe('Privacy snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Privacy projectId="0" task={{ id: '0', isPrivate: false }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
