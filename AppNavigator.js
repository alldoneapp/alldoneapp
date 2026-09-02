import React from 'react'
import { Dimensions, View } from 'react-native'

import store from './redux/store'
import NavigationService from './utils/NavigationService'
import RootView from './components/RootView/RootView'
import LoginScreen from './components/LoginScreen/LoginScreen'
import TaskDetailedView from './components/TaskDetailedView/TaskDetailedView'
import UserDetailedView from './components/UserDetailedView/UserDetailedView'
import ContactDetailedView from './components/ContactDetailedView/ContactDetailedView'
import ProjectDetailedView from './components/ProjectDetailedView/ProjectDetailedView'
import GoalDetailedView from './components/GoalDetailedView/GoalDetailedView'
import PrivateResourcePage from './components/PrivateResource/PrivateResourcePage'
import PaymentSuccessPage from './components/PaymentSuccess/PaymentSuccessPage'
import AppAuthPage from './components/AppAuth/AppAuthPage'
import OnboardingView from './components/Onboarding/OnboardingView'
import WhatsAppOnboarding from './components/Onboarding/WhatsAppOnboarding'
import MeetingBookingPage from './components/MeetingBooking/MeetingBookingPage'
import NoteMaxLengthModal from './components/UIComponents/FloatModals/NoteMaxLengthModal'
import {
    hideWebSideBar,
    setShowWebSideBar,
    toggleMiddleScreen,
    toggleMiddleScreenNoteDV,
    toggleReallySmallScreenNavigation,
    toggleSmallScreen,
    toggleSmallScreenNavigation,
    toggleSmallScreenNavSidebarCollapsed,
} from './redux/actions'
import DismissibleModal from './components/UIComponents/DismissibleModal'
import SettingsView from './components/SettingsView/SettingsView'
import { notifyClickObservers } from './utils/Observers'
import NoteChangedNotificationModal from './components/UIComponents/FloatModals/NoteChangedNotificationModal'
import NotesDetailedView from './components/NotesView/NotesDV/NotesDetailedView'
import ChatDetailedView from './components/ChatsView/ChatDetailedView'
import SkillDetailedView from './components/SkillDetailedView/SkillDetailedView'
import AdminPanelView from './components/AdminPanel/AdminPanelView'
import AssistantDetailedView from './components/AssistantDetailedView/AssistantDetailedView'
import { scrollDocumentToTop } from './utils/scrollUtils'
import { startVirtualKeyboardViewport } from './utils/virtualKeyboard'
import { installEscapeStack } from './utils/escapeStack'
import { installConnectionStateListener } from './utils/connectionState'
import { installShellOtaUpdater } from './utils/shellOtaUpdater'
import { installConnectionHealthMonitor } from './utils/connectionHealth'
import { installAppResumeListener } from './utils/appResume'
import { installPassiveVirtualizedListWheel } from './utils/passiveVirtualizedListWheel'
import ShellInsetPainter from './components/CapacitorShell/ShellInsetPainter'
import { getResponsiveLayoutState } from './utils/responsiveLayout'

const getCurrentResponsiveLayout = width => {
    const { loggedUser, route } = store.getState()
    return getResponsiveLayoutState({ width, sidebarExpanded: loggedUser.sidebarExpanded, route })
}

// Seed the responsive Redux flags before AppContent's first render. This is
// intentionally separate from the outer View's onLayout handler: on a cached
// mobile boot the task board can be visible for well over a second before that
// first layout callback, which otherwise exposes the desktop defaults.
export const initializeResponsiveLayout = () => {
    const width = Dimensions.get('window').width
    if (!Number.isFinite(width) || width <= 0) return

    const current = store.getState()
    const next = getResponsiveLayoutState({
        width,
        sidebarExpanded: current.loggedUser.sidebarExpanded,
        route: current.route,
    })
    const dispatches = []

    if (current.showWebSideBar.visible && next.smallScreenNavigation) dispatches.push(hideWebSideBar())
    if (current.isMiddleScreen !== next.isMiddleScreen) dispatches.push(toggleMiddleScreen(next.isMiddleScreen))
    if (current.isMiddleScreenNoteDV !== next.isMiddleScreenNoteDV) {
        dispatches.push(toggleMiddleScreenNoteDV(next.isMiddleScreenNoteDV))
    }
    if (current.smallScreen !== next.smallScreen) dispatches.push(toggleSmallScreen(next.smallScreen))
    if (current.smallScreenNavigation !== next.smallScreenNavigation) {
        dispatches.push(toggleSmallScreenNavigation(next.smallScreenNavigation))
    }
    if (current.reallySmallScreenNavigation !== next.reallySmallScreenNavigation) {
        dispatches.push(toggleReallySmallScreenNavigation(next.reallySmallScreenNavigation))
    }
    if (current.smallScreenNavSidebarCollapsed !== next.smallScreenNavSidebarCollapsed) {
        dispatches.push(toggleSmallScreenNavSidebarCollapsed(next.smallScreenNavSidebarCollapsed))
    }

    if (dispatches.length > 0) store.dispatch(dispatches)
}

const onLayoutChange = layout => {
    const {
        isMiddleScreen,
        smallScreenNavigation,
        reallySmallScreenNavigation,
        smallScreenNavSidebarCollapsed,
        smallScreen,
        isMiddleScreenNoteDV,
        showWebSideBar,
    } = store.getState()

    let widthScreenNavigation = layout.nativeEvent.layout.width
    if (widthScreenNavigation === 0) {
        widthScreenNavigation = Dimensions.get('window').width
    }

    const next = getCurrentResponsiveLayout(widthScreenNavigation)

    if (next.smallScreenNavigation) {
        //This conditional is to avoid setting the state every time the layout changes while the condition is false
        if (showWebSideBar.visible && !smallScreenNavigation) {
            store.dispatch(hideWebSideBar())
        }
    }
    //This conditional is to avoid setting the state every time the layout changes while the condition is true
    else if (!showWebSideBar.visible) {
        store.dispatch(setShowWebSideBar())
    }

    const dispatches = []

    if (next.reallySmallScreenNavigation) {
        if (!reallySmallScreenNavigation) {
            dispatches.push(toggleReallySmallScreenNavigation(true))
        }
    } else if (reallySmallScreenNavigation) {
        dispatches.push(toggleReallySmallScreenNavigation(false))
    }

    // For screen size under breakpoint navigation
    if (next.smallScreenNavigation) {
        if (!smallScreenNavigation) {
            dispatches.push(toggleSmallScreenNavigation(true))
        }
    } else if (smallScreenNavigation) {
        dispatches.push(toggleSmallScreenNavigation(false))
    }

    // For screen size under breakpoint navigation sidebar collapsed
    if (next.smallScreenNavSidebarCollapsed) {
        if (!smallScreenNavSidebarCollapsed) {
            dispatches.push(toggleSmallScreenNavSidebarCollapsed(true))
        }
    } else if (smallScreenNavSidebarCollapsed) {
        dispatches.push(toggleSmallScreenNavSidebarCollapsed(false))
    }

    dispatches.length > 0 && store.dispatch(dispatches)

    // For screen size under breakpoint
    if (next.smallScreen) {
        if (!smallScreen) {
            store.dispatch(toggleSmallScreen(true))
        }
    } else if (smallScreen) {
        store.dispatch(toggleSmallScreen(false))
    }

    if (next.isMiddleScreen) {
        if (!isMiddleScreen) store.dispatch(toggleMiddleScreen(true))
    } else {
        if (isMiddleScreen) store.dispatch(toggleMiddleScreen(false))
    }

    // This specific breakpoint allows a nice responsive behavior in NoteDV
    // The Note Toolbar and Tag List needs to jump to mobile earlier than the rest of view
    if (next.isMiddleScreenNoteDV) {
        if (!isMiddleScreenNoteDV) {
            store.dispatch(toggleMiddleScreenNoteDV(true))
        }
    } else {
        if (isMiddleScreenNoteDV) {
            store.dispatch(toggleMiddleScreenNoteDV(false))
        }
    }
}

// The standard screen chrome the old stack navigator wrapped around most
// screens: responsive relayout on the outer View, click-observer notification
// on the inner one. Dismissible-touch capture is a document-level listener now
// (installed by AppContainer below) instead of the old pair of a wrapper
// responder + a patched react-native-web TouchableOpacity: the responder
// negotiation never reached the wrapper when an inner touchable claimed the
// touch, which is exactly why replacement_node_modules carried that patch.
// A DOM capture-phase listener sees every press regardless of what claims it.
const ScreenWrapper = ({ children }) => (
    <View style={{ flex: 1 }} onLayout={onLayoutChange}>
        <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
            {children}
        </View>
    </View>
)

// Route map replacing the old createStackNavigator config. `wrapped` mirrors
// which screens had the chrome wrapper; `extra` renders the wrapper-level
// modals some screens carried.
const ROUTES = {
    Root: { screen: RootView, wrapped: true, extra: NoteChangedNotificationModal },
    TaskDetailedView: { screen: TaskDetailedView, wrapped: true },
    UserDetailedView: { screen: UserDetailedView, wrapped: true },
    ContactDetailedView: { screen: ContactDetailedView, wrapped: true },
    SettingsView: { screen: SettingsView, wrapped: true },
    AdminPanelView: { screen: AdminPanelView, wrapped: true },
    ProjectDetailedView: { screen: ProjectDetailedView, wrapped: true },
    NotesDetailedView: { screen: NotesDetailedView, wrapped: true, extra: NoteMaxLengthModal },
    GoalDetailedView: { screen: GoalDetailedView, wrapped: true },
    SkillDetailedView: { screen: SkillDetailedView, wrapped: true },
    AssistantDetailedView: { screen: AssistantDetailedView, wrapped: true },
    ChatDetailedView: { screen: ChatDetailedView, wrapped: true },
    LoginScreen: { screen: LoginScreen, wrapped: false },
    PrivateResource: { screen: PrivateResourcePage, wrapped: false },
    PaymentSuccess: { screen: PaymentSuccessPage, wrapped: false },
    AppAuth: { screen: AppAuthPage, wrapped: false },
    Onboarding: { screen: OnboardingView, wrapped: true },
    WhatsAppOnboarding: { screen: WhatsAppOnboarding, wrapped: true },
    MeetingBooking: { screen: MeetingBookingPage, wrapped: false },
}

// Renders the single active screen from NavigationService's route store
// (initial route: LoginScreen, as before). A class component so AppContent's
// legacy ref callback stays harmless. Each navigation remounts the subtree via
// the state id key — the old navigator reset the stack on every navigate, so
// screens rely on fresh mounts.
// react-native-web's lists register a scroll-blocking (non-passive) `wheel` listener on
// every mount, which Chrome reports as a `[Violation]` each time. Unlike the listeners
// installed in `componentDidMount` below this is a PROTOTYPE patch and has to land before
// the first list mounts — `componentDidMount` runs children-first, so from there it would
// miss every list on the first screen. Module scope is the only place early enough.
installPassiveVirtualizedListWheel()

export class AppContainer extends React.Component {
    state = NavigationService.getCurrentState()

    componentDidMount() {
        this.unsubscribe = NavigationService.subscribe(navState => this.setState(navState))
        document.addEventListener('mousedown', this.handleDomPointerDown, true)
        // touchstart is scroll-blocking: register it passive (the handler only
        // reads coordinates and never calls preventDefault) so Chrome does not
        // have to wait on it before scrolling.
        document.addEventListener('touchstart', this.handleDomPointerDown, { capture: true, passive: true })
        // Mobile virtual keyboard (AT-2248): shrink the shell by the keyboard
        // inset and keep the focused input visible. Installed here for the same
        // reason as the listeners above — this is the one component that mounts
        // once for the whole app and owns its document-level listeners.
        this.stopVirtualKeyboardViewport = startVirtualKeyboardViewport()
        // Escape-to-close (AT-2257): react-native-web's TextInput stops
        // propagation of every keydown, so a bubble-phase document listener —
        // which is what every popup in this app uses — never sees Escape while a
        // field has focus. The dispatcher listens in the CAPTURE phase instead.
        // Installed here for the same reason as the listeners above: this is the
        // one component that mounts once for the whole app and owns its
        // document-level listeners.
        this.stopEscapeStack = installEscapeStack()
        // Connectivity signal (OFFLINE_SUPPORT_PLAN.md Stage 1): feeds the
        // `connectionState` redux slice from the browser online/offline events.
        // Installed here for the same reason as the listeners above.
        this.stopConnectionStateListener = installConnectionStateListener()
        // iOS Capacitor shell: confirm this boot as healthy (rollback guard)
        // and track web deploys over the air. No-op everywhere else.
        // It returns the "check for a new web deploy" callback rather than
        // listening for itself, so the resume signal keeps its single owner below.
        const checkShellOtaUpdate = installShellOtaUpdater()
        // Connection health (PT-4660): `connectionState` above only reports what the
        // BROWSER believes. These two add what the app can actually prove — a resume
        // signal that coalesces visibilitychange/pageshow/focus into one event, and a
        // monitor that probes the server when the connection looks suspect. Installed
        // here for the same reason as the listeners above.
        this.stopConnectionHealthMonitor = installConnectionHealthMonitor()
        // The OTA check rides that coalesced signal: `pageshow` after a bfcache
        // restore is the only return signal an iOS home-screen shell reliably
        // sends, and it is already handled here.
        this.stopAppResumeListener = installAppResumeListener({ onResume: checkShellOtaUpdate })
    }

    componentDidUpdate(prevProps, prevState) {
        // The old stack navigator rendered each screen in its own card, so the
        // page scroll position never carried over. Screens flow in the body
        // now, and browsers can keep the offset on window, documentElement, or
        // body — start every freshly navigated screen at the top in all cases.
        if (prevState.id !== this.state.id) {
            scrollDocumentToTop()
        }
    }

    componentWillUnmount() {
        this.unsubscribe && this.unsubscribe()
        document.removeEventListener('mousedown', this.handleDomPointerDown, true)
        document.removeEventListener('touchstart', this.handleDomPointerDown, { capture: true })
        this.stopVirtualKeyboardViewport && this.stopVirtualKeyboardViewport()
        this.stopEscapeStack && this.stopEscapeStack()
        this.stopConnectionStateListener && this.stopConnectionStateListener()
        this.stopConnectionHealthMonitor && this.stopConnectionHealthMonitor()
        this.stopAppResumeListener && this.stopAppResumeListener()
    }

    // Feeds every press on the page into the dismissible-modal system with the
    // minimal synthetic-event shape captureDismissibleTouch reads.
    handleDomPointerDown = e => {
        const touch = e.touches ? e.touches[0] : e
        if (!touch || touch.pageX === undefined) return
        DismissibleModal.captureDismissibleTouch({
            persist: () => {},
            nativeEvent: { pageX: touch.pageX, pageY: touch.pageY },
        })
    }

    render() {
        const { routeName, id } = this.state
        const route = ROUTES[routeName] || ROUTES.LoginScreen
        const navigation = NavigationService.createNavigationProp()
        const Screen = route.screen
        const Extra = route.extra

        const content = (
            <React.Fragment>
                <Screen navigation={navigation} />
                {Extra ? <Extra /> : null}
            </React.Fragment>
        )

        return (
            <React.Fragment key={id}>
                {route.wrapped ? <ScreenWrapper>{content}</ScreenWrapper> : content}
                <ShellInsetPainter routeName={routeName} />
            </React.Fragment>
        )
    }
}
