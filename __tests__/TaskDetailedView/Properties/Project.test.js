/**
 * @jest-environment jsdom
 */

import React from 'react'
import Project from '../../../components/TaskDetailedView/Properties/Project'

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

describe('Project component', () => {
    describe('Project snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Project project={{ name: '', color: '' }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
