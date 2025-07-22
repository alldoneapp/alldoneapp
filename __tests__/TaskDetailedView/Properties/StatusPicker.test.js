import React from 'react'
import StatusPicker from '../../../components/TaskDetailedView/Properties/StatusPicker'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('StatusPicker component', () => {
    describe('StatusPicker snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<StatusPicker projectId="0" task={{ id: '0', done: false }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
