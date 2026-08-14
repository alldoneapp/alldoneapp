import React from 'react'
import NavigationBar from '../components/NavigationBar/NavigationBar'
import { Platform } from 'react-native'
import { Provider } from 'react-redux'
import store from '../redux/store'

import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useDispatch: jest.fn(),
}))

// componentDidMount mounts a Hotkeys listener with ReactDOM.findDOMNode plus
// ReactDOM.render. react-test-renderer builds no real DOM, so findDOMNode
// returns null and render rejects the container.
jest.mock('react-dom', () => ({
    ...jest.requireActual('react-dom'),
    findDOMNode: jest.fn(() => globalThis.document.createElement('div')),
    render: jest.fn(),
}))

describe('NavigationBar component', () => {
    const navigationMock = {
        openDrawer: () => {},
    }

    // NavigationBar is still a class, but it renders children that read redux
    // through hooks, so it needs a Provider above it. That makes the Provider
    // the root, so the instance has to come from a ref rather than
    // tree.getInstance().
    const render = (props = {}) => {
        const ref = React.createRef()
        const tree = renderer.create(
            <Provider store={store}>
                <NavigationBar ref={ref} tabs={['a', 'b', 'c', 'd']} navigation={navigationMock} {...props} />
            </Provider>
        )
        return { tree, instance: ref.current }
    }

    describe('NavigationBar web snapshot test', () => {
        Platform.OS = 'web'
        it('should render correctly', () => {
            expect(render().tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('NavigationBar web snapshot test', () => {
        Platform.OS = 'web'
        it('should render correctly when likeWeb is true', () => {
            expect(render({ likeWeb: true }).tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('NavigationBar mobile snapshot test', () => {
        Platform.OS = 'ios'
        it('should render correctly', () => {
            expect(render().tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('NavigationBar small screen snapshot test', () => {
        it('should render correctly', () => {
            Platform.OS = 'web'
            const { instance } = render()
            instance.setState({ smallScreen: true })
            instance.props.likeWeb = true

            expect(() => instance.render()).not.toThrow()

            Platform.OS = 'ios'
            expect(() => instance.render()).not.toThrow()
        })
    })

    describe('test component methods call', () => {
        it('should toggleNavPicker on', () => {
            const { instance } = render()
            instance.toggleNavPickerOn()
            expect(store.getState().expandedNavPicker).toEqual(true)
        })

        it('should toggleNavPicker off', () => {
            const { instance } = render()
            instance.state.expanded = false
            instance.toggleNavPickerOff()
            expect(store.getState().expandedNavPicker).toEqual(false)
        })

        it('after call componentWillUnmount should render correctly', () => {
            const { instance } = render()
            expect(() => instance.componentWillUnmount()).not.toThrow()
        })

        it('after call expandPicker should render correctly', () => {
            const { instance } = render()
            expect(() => instance.expandPicker()).not.toThrow()
        })

        it('after call expandPicker when is expanded should render correctly', () => {
            const { instance } = render()
            instance.state.expanded = true
            expect(() => instance.expandPicker()).not.toThrow()
        })
    })
})
