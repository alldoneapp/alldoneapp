import React from 'react'
import LoginScreen from '../components/LoginScreen'
import store from '../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { setOnline } from '../redux/actions'

jest.mock('../utils/backends/firestore')

jest.mock('../components/MyPlatform', () => {
    return {
        __esModule: true,
        default: {
            isMobile: () => false,
        },
    }
})

jest.mock('../utils/BackendBridge', () => {
    let innerValues = {
        isNewUser: true,
    }
    return {
        __esModule: true,
        default: {
            loginWithGoogle: () => {
                return { additionalUserInfo: { isNewUser: innerValues.isNewUser } }
            },
            uploadNewUser: () => {},
            getProjectsByUser: () => {},
            setInnerValue: x => {
                innerValues = x
            },
            mapUserData: () => {},
        },
    }
})

const initialState = {
    user: {
        uid: '1',
        displayName: 'Dummy Doe',
        photoURL: 'https://somewhereInTheInternet.com/any.png',
    },
    loggedIn: true,
    online: true,
    initialUrl: 'alldone.aleph.engineering/tasks',
}

describe('LoginScreen component', () => {
    store.dispatch(setOnline(true))
    describe('method test', () => {
        xit('after call componentDidMount should render correctly', () => {
            const tree = renderer.create(<LoginScreen />)
            const instance = tree.getInstance()
            instance.componentDidMount()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('should navigate to App after projects load', async () => {
            const tree = renderer.create(<LoginScreen navigation={{ navigate: () => {} }} />)
            const instance = tree.getInstance()
            instance.afterProjectsLoad()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})

jest.mock('../redux/store', () => {
    let innerState = {
        user: {
            uid: '1',
            displayName: 'Dummy Doe',
            photoURL: 'https://somewhereInTheInternet.com/any.png',
        },
        loggedIn: true,
        online: true,
    }
    return {
        __esModule: true,
        default: {
            subscribe: x => {},
            unsubscribe: () => {},
            getState: () => {
                return {
                    loggedIn: innerState.loggedIn,
                    loggedUser: innerState.user,
                    online: innerState.online,
                }
            },
            dispatch: x => {
                if (x.type) return
                innerState = x
            },
        },
        foo: jest.fn(() => 43),
    }
})

//This component imports implicitly react-native-gesture-handler, a specific
//Jest setup is required for Jest to test it properly.
//See https://www.gitmemory.com/issue/kmagiera/react-native-gesture-handler/344/489547513 and
//https://stackoverflow.com/questions/57595093/cannot-read-property-direction-of-undefined-tests-only
describe('LoginScreen component', () => {
    describe('LoginScreen snapshot test', () => {
        xit('should render correctly', () => {
            store.dispatch(initialState)
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <LoginScreen />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        xit('should render correctly', () => {
            store.dispatch({
                user: {
                    uid: '1',
                    displayName: 'Dummy Doe',
                    photoURL: 'https://somewhereInTheInternet.com/any.png',
                },
                loggedIn: true,
                online: false,
                initialUrl: 'alldone.aleph.engineering/tasks',
            })
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <LoginScreen />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()

            store.dispatch(initialState)
        })
    })

    describe('LoginScreen snapshot test', () => {
        xit('should load user projects', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <LoginScreen />
                    </Provider>
                )
                .toJSON()

            expect(tree).toMatchSnapshot()
        })
    })

    describe('LoginScreen snapshot test', () => {
        it('should render when there is no user logged', () => {
            store.dispatch({
                loggedIn: false,
                online: true,
                user: {
                    uid: '1',
                    displayName: 'Dummy Doe',
                    photoURL: 'https://somewhereInTheInternet.com/any.png',
                },
            })
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <LoginScreen />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('method test', () => {
        it('should update the state', () => {
            const tree = renderer.create(<LoginScreen />)

            const instance = tree.getInstance()

            instance.updateState()
        })

        it('should unmount the without errors', () => {
            const tree = renderer.create(<LoginScreen />)
            tree.getInstance().state.unsubscribe = () => {}
            tree.unmount()
        })
    })
})
