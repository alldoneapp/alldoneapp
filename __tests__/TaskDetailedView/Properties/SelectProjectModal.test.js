import React from 'react'
import SelectProjectModal from '../../../components/UIComponents/FloatModals/SelectProjectModal/SelectProjectModal'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            loggedUser: { id: '0' },
            screenDimensions: { height: 1024 }
        })
    })
}));

describe('SelectProjectModal component', () => {
    const task = { id: 'id1', name: 'task1' }
    describe('SelectProjectModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SelectProjectModal task={task} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
