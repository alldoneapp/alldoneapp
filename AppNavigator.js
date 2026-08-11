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
import {
    SCREEN_BREAKPOINT,
    SCREEN_BREAKPOINT_MIDDLE,
    SCREEN_BREAKPOINT_NAV,
    SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED,
    SCREEN_SMALL_BREAKPOINT_NAV,
    SIDEBAR_MENU_WIDTH,
} from './components/styles/global'
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

const onLayoutChange = layout => {
    const {
        isMiddleScreen,
        smallScreenNavigation,
        reallySmallScreenNavigation,
        smallScreenNavSidebarCollapsed,
        smallScreen,
        isMiddleScreenNoteDV,
        showWebSideBar,
        route,
        loggedUser,
    } = store.getState()

    const { sidebarExpanded } = loggedUser
    const screenBreakpointNav = sidebarExpanded ? SCREEN_BREAKPOINT_NAV : SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED

    let widthScreenNavigation = layout.nativeEvent.layout.width
    if (widthScreenNavigation === 0) {
        widthScreenNavigation = Dimensions.get('window').width
    }

    let widthScreen =
        widthScreenNavigation < screenBreakpointNav ? widthScreenNavigation : widthScreenNavigation - SIDEBAR_MENU_WIDTH

    if (widthScreenNavigation <= screenBreakpointNav) {
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

    if (widthScreenNavigation <= SCREEN_SMALL_BREAKPOINT_NAV) {
        if (!reallySmallScreenNavigation) {
            dispatches.push(toggleReallySmallScreenNavigation(true))
        }
    } else if (reallySmallScreenNavigation) {
        dispatches.push(toggleReallySmallScreenNavigation(false))
    }

    // For screen size under breakpoint navigation
    if (widthScreenNavigation <= screenBreakpointNav) {
        if (!smallScreenNavigation) {
            dispatches.push(toggleSmallScreenNavigation(true))
        }
    } else if (smallScreenNavigation) {
        dispatches.push(toggleSmallScreenNavigation(false))
    }

    // For screen size under breakpoint navigation sidebar collapsed
    if (widthScreenNavigation <= SCREEN_BREAKPOINT_NAV) {
        if (!smallScreenNavSidebarCollapsed) {
            dispatches.push(toggleSmallScreenNavSidebarCollapsed(true))
        }
    } else if (smallScreenNavSidebarCollapsed) {
        dispatches.push(toggleSmallScreenNavSidebarCollapsed(false))
    }

    dispatches.length > 0 && store.dispatch(dispatches)

    // For screen size under breakpoint
    if (widthScreen <= SCREEN_BREAKPOINT) {
        if (!smallScreen) {
            store.dispatch(toggleSmallScreen(true))
        }
    } else if (smallScreen) {
        store.dispatch(toggleSmallScreen(false))
    }

    if (widthScreen <= SCREEN_BREAKPOINT_MIDDLE - SIDEBAR_MENU_WIDTH) {
        if (!isMiddleScreen) store.dispatch(toggleMiddleScreen(true))
    } else {
        if (isMiddleScreen) store.dispatch(toggleMiddleScreen(false))
    }

    // This specific breakpoint allows a nice responsive behavior in NoteDV
    // The Note Toolbar and Tag List needs to jump to mobile earlier than the rest of view
    if (
        widthScreen <= SCREEN_BREAKPOINT_MIDDLE &&
        (route === 'NotesDetailedView' ||
            route === 'ChatDetailedView' ||
            route === 'ContactDetailedView' ||
            route === 'GoalDetailedView' ||
            route === 'SkillDetailedView' ||
            route === 'AssistantDetailedView' ||
            route === 'TaskDetailedView' ||
            route === 'UserDetailedView')
    ) {
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
export class AppContainer extends React.Component {
    state = NavigationService.getCurrentState()

    componentDidMount() {
        this.unsubscribe = NavigationService.subscribe(navState => this.setState(navState))
        document.addEventListener('mousedown', this.handleDomPointerDown, true)
        // touchstart is scroll-blocking: register it passive (the handler only
        // reads coordinates and never calls preventDefault) so Chrome does not
        // have to wait on it before scrolling.
        document.addEventListener('touchstart', this.handleDomPointerDown, { capture: true, passive: true })
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
            </React.Fragment>
        )
    }
}
