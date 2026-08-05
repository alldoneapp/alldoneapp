// Replaces react-navigation (migration Stage 2). The app never used stack
// semantics: the old implementation dispatched StackActions.reset on every
// navigate, i.e. "show exactly one named screen with params, remounted fresh".
// This module keeps that contract with a tiny observable route store that
// AppNavigator renders from. The public surface the codebase relies on is
// navigate(routeName, params), plus the navigation prop shape passed to
// screens: { navigate, getParam, state: { params } }.

let navState = { routeName: 'LoginScreen', params: undefined, id: 0 }
const listeners = new Set()

function navigate(routeName, params) {
    // id changes on every navigation; AppNavigator keys the screen subtree with
    // it so a navigate always remounts, exactly like the old StackActions.reset.
    navState = { routeName, params, id: navState.id + 1 }
    listeners.forEach(listener => listener(navState))
}

function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function getCurrentState() {
    return navState
}

// The navigation prop handed to the active screen. Params are captured at
// creation so the screen keeps seeing its own params for its whole lifetime
// (only one screen is ever mounted, and navigating remounts it).
function createNavigationProp() {
    const { params } = navState
    return {
        navigate,
        getParam: (key, fallback) => (params && params[key] !== undefined ? params[key] : fallback),
        state: { params: params || {} },
    }
}

// Legacy no-op: AppContent still passes the container ref here. The route store
// is module-global now, so there is no navigator instance to register.
function setTopLevelNavigator() {}

export default {
    navigate,
    subscribe,
    getCurrentState,
    createNavigationProp,
    setTopLevelNavigator,
}
