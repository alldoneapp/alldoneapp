/**
 * @jest-environment jsdom
 */

// AT-2276: an unregistered visitor opening https://my.alldone.app/meet/<slug> must land on the
// booking page directly. Before the fix the boot path mounted the login ("you are not registered")
// screen first, which also rewrote the address bar to /login and started an anonymous sign-in.
//
// AppNavigator is stubbed with a container that records every route it renders, so "the login
// screen was never mounted" is an assertion instead of a guess.

jest.mock('../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../utils/backends/firestore'),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://localhost:1234' }),
}))

jest.mock('../AppNavigator', () => {
    const ReactModule = require('react')
    const NavigationService = require('../utils/NavigationService').default

    class AppContainer extends ReactModule.Component {
        constructor(props) {
            super(props)
            this.state = NavigationService.getCurrentState()
        }

        componentDidMount() {
            this.unsubscribe = NavigationService.subscribe(navState => this.setState(navState))
        }

        componentWillUnmount() {
            if (this.unsubscribe) this.unsubscribe()
        }

        render() {
            global.__renderedRoutes.push(this.state.routeName)
            return null
        }
    }

    return { __esModule: true, AppContainer }
})

jest.mock('../components/LoadingScreen', () => ({
    __esModule: true,
    default: () => {
        global.__loadingScreenRendered = true
        return null
    },
}))

jest.mock('../components/ProgressiveLoadingScreen', () => ({
    __esModule: true,
    default: () => {
        global.__loadingScreenRendered = true
        return null
    },
}))

jest.mock('../components/Analytics/AnalyticsConsentManager', () => ({ __esModule: true, default: () => null }))

// Only mounted for a logged-in user; stubbed because lottie-web needs a real canvas.
jest.mock('../components/UIComponents/FloatModals/EndDayStatisticsModal', () => ({
    __esModule: true,
    default: () => null,
}))

jest.mock('../utils/Geolocation/GeolocationHelper', () => ({ initIpRegistry: () => {} }))

jest.mock('../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        initFirebase: callback => {
            global.__firebaseAuthCallback = callback
        },
        logout: resolve => resolve && resolve(),
    },
}))

// Each case boots the app from scratch (one module registry per boot, so redux starts with
// `loggedIn: null` - auth not answered yet, which is the state the regression lives in). React and
// react-redux are required from that same fresh registry, or the app would render against a second
// React copy with no hook dispatcher.
let act

const bootApp = async pathname => {
    window.history.replaceState({}, '', pathname)
    global.__renderedRoutes = []
    global.__loadingScreenRendered = false
    global.__firebaseAuthCallback = null

    jest.resetModules()
    const React = require('react')
    const renderer = require('react-test-renderer')
    const { Provider } = require('react-redux')
    act = renderer.act

    const modules = {
        AppContent: require('../AppContent').default,
        store: require('../redux/store').default,
        NavigationService: require('../utils/NavigationService').default,
    }

    await act(async () => {
        modules.tree = renderer.create(
            React.createElement(Provider, { store: modules.store }, React.createElement(modules.AppContent))
        )
    })

    return modules
}

const answerAuthWithNoSession = async () => {
    await act(async () => {
        await global.__firebaseAuthCallback(null)
    })
}

describe('Public meeting link boot path (AT-2276)', () => {
    it('renders the booking page immediately, without waiting for Firebase auth', async () => {
        const { NavigationService } = await bootApp('/meet/karsten-wysk')

        expect(global.__renderedRoutes).toEqual(['MeetingBooking'])
        expect(NavigationService.getCurrentState().params).toEqual({ slug: 'karsten-wysk' })
        // No "connecting" spinner in front of a page that needs no account and no app data.
        expect(global.__loadingScreenRendered).toBe(false)
    })

    it('never mounts the login screen and keeps the booking URL in the address bar', async () => {
        const { NavigationService, store } = await bootApp('/meet/karsten-wysk')

        await answerAuthWithNoSession()

        expect(global.__renderedRoutes).not.toContain('LoginScreen')
        expect(NavigationService.getCurrentState().routeName).toBe('MeetingBooking')
        expect(window.location.pathname).toBe('/meet/karsten-wysk')
        expect(store.getState().loggedIn).toBe(false)
        expect(store.getState().initialUrl).toBe('/meet/karsten-wysk')
    })

    it('keeps a query string on the booking link', async () => {
        const { store } = await bootApp('/meet/karsten-wysk?utm_source=signature')

        await answerAuthWithNoSession()

        expect(global.__renderedRoutes).not.toContain('LoginScreen')
        expect(store.getState().initialUrl).toBe('/meet/karsten-wysk?utm_source=signature')
    })

    it('still sends a logged-out visitor of a normal app URL to the login screen', async () => {
        const { NavigationService } = await bootApp('/projects/tasks/open')

        // Auth has not answered yet: the app shell stays behind the loading screen as before.
        expect(global.__loadingScreenRendered).toBe(true)
        expect(global.__renderedRoutes).toEqual([])

        await answerAuthWithNoSession()

        expect(NavigationService.getCurrentState().routeName).toBe('LoginScreen')
        expect(global.__renderedRoutes).toEqual(['LoginScreen'])
    })
})
