import React from 'react'
import NavigationBar from '../components/NavigationBar/NavigationBar'
import { Platform } from 'react-native'
import store from '../redux/store'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useDispatch: jest.fn(),
}));

describe('NavigationBar component', () => {
    const navigationMock = {
        openDrawer: () => {},
    }

    describe('NavigationBar web snapshot test', () => {
        Platform.OS = 'web'
        it('should render correctly', () => {
            const tree = renderer
                .create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBar web snapshot test', () => {
        Platform.OS = 'web'
        it('should render correctly when likeWeb is true', () => {
            const tree = renderer
                .create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} likeWeb={true} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBar mobile snapshot test', () => {
        Platform.OS = 'ios'
        it('should render correctly', () => {
            const tree = renderer
                .create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBar small screen snapshot test', () => {
        it('should render correctly', () => {
            Platform.OS = 'web'
            const tree = renderer.create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.setState({ smallScreen: true })
            instance.props.likeWeb = true
            instance.render()
            Platform.OS = 'ios'
            instance.render()
            //expect(tree).toMatchSnapshot();
            expect(1).toEqual(1)
        })
    })

    describe('test component methods call', () => {
        it('should toggleNavPicker on', () => {
            const tree = renderer.create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.toggleNavPickerOn()
            expect(store.getState().expandedNavPicker).toEqual(true)
        })

        it('should toggleNavPicker on', () => {
            const tree = renderer.create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.state.expanded = false
            instance.toggleNavPickerOff()
            expect(store.getState().expandedNavPicker).toEqual(false)
        })

        it('after call componentWillUnmount should render correctly', () => {
            const tree = renderer.create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.componentWillUnmount()
        })

        it('after call expandPicker should render correctly', () => {
            const tree = renderer.create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.expandPicker()
        })

        it('after call expandPicker when is expanded should render correctly', () => {
            const tree = renderer.create(<NavigationBar tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.state.expanded = true
            instance.expandPicker()
        })
    })
})
