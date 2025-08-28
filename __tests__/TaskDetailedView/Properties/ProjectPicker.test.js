/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectPicker from '../../../components/TaskDetailedView/Properties/ProjectPicker'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));
jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            smallScreenNavigation: {}
        })
    }),
}));

describe('ProjectPicker component', () => {
    describe('ProjectPicker snapshot test', () => {
        it('should render correctly', () => {
            const project = { name: 'Fireworks', color: 'rgb(69, 69, 69) ;)' }
            const tree = renderer.create(<ProjectPicker project={project}/>).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
