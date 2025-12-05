import React from 'react'
import { Dimensions, View } from 'react-native'
import { createAppContainer } from 'react-navigation'
import { createStackNavigator } from 'react-navigation-stack'

import store from './redux/store'
import RootView from './components/RootView/RootView'
import LoginScreen from './components/LoginScreen/LoginScreen'
import TaskDetailedView from './components/TaskDetailedView/TaskDetailedView'
import UserDetailedView from './components/UserDetailedView/UserDetailedView'
import ContactDetailedView from './components/ContactDetailedView/ContactDetailedView'
import ProjectDetailedView from './components/ProjectDetailedView/ProjectDetailedView'
import GoalDetailedView from './components/GoalDetailedView/GoalDetailedView'
import PrivateResourcePage from './components/PrivateResource/PrivateResourcePage'
import PaymentSuccessPage from './components/PaymentSuccess/PaymentSuccessPage'
import OnboardingView from './components/Onboarding/OnboardingView'
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

const AppStack = createStackNavigator(
    {
        Root: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <RootView navigation={props.navigation} />
                        <NoteChangedNotificationModal />
                    </View>
                </View>
            ),
        },
        TaskDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <TaskDetailedView navigation={props.navigation}></TaskDetailedView>
                    </View>
                </View>
            ),
        },
        UserDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <UserDetailedView navigation={props.navigation}></UserDetailedView>
                    </View>
                </View>
            ),
        },
        ContactDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <ContactDetailedView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        SettingsView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <SettingsView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        AdminPanelView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <AdminPanelView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        ProjectDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <ProjectDetailedView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        NotesDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <NotesDetailedView navigation={props.navigation} />
                        <NoteMaxLengthModal />
                    </View>
                </View>
            ),
        },
        GoalDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <GoalDetailedView navigation={props.navigation}></GoalDetailedView>
                    </View>
                </View>
            ),
        },
        SkillDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <SkillDetailedView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        AssistantDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <AssistantDetailedView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        ChatDetailedView: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <ChatDetailedView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
        LoginScreen: LoginScreen,
        PrivateResource: PrivateResourcePage,
        PaymentSuccess: PaymentSuccessPage,
        Onboarding: {
            screen: props => (
                <View
                    style={{ flex: 1 }}
                    onStartShouldSetResponder={DismissibleModal.captureDismissibleTouch}
                    onLayout={onLayoutChange}
                >
                    <View onStartShouldSetResponder={notifyClickObservers} style={{ flex: 1 }}>
                        <OnboardingView navigation={props.navigation} />
                    </View>
                </View>
            ),
        },
    },
    {
        initialRouteName: 'LoginScreen',
        headerMode: 'none',
        navigationOptions: {
            gesturesEnabled: false,
            animationEnabled: false,
        },
        defaultNavigationOptions: {
            gestureEnabled: false,
            animationEnabled: false,
        },
    }
)

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

export const AppContainer = createAppContainer(AppStack)
