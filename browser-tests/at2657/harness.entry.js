import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'
import { createStore } from 'redux'
import { View, Text } from 'react-native'
import LoadingData from '../../components/UIComponents/LoadingData'
import CustomScrollView from '../../components/UIControls/CustomScrollView'
import useModalSizing from '../../hooks/useModalSizing'
import {
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_VIEWPORT_GAP,
    getFloatingActionBottom,
} from '../../components/UIComponents/floatingActionLayout'

import { SIDEBAR_MENU_WIDTH, SIDEBAR_MENU_COLLAPSED_WIDTH } from '../../components/styles/global'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'
import { isAnnaMode } from '../../utils/annaMode'

const params = new URLSearchParams(window.location.search)
const loggedUser = { sidebarExpanded: !params.has('collapsed'), isAnonymous: params.has('anonymous') }
const initialState = {
    showLoadingDataSpinner: true,
    loggedUser,
    ...getResponsiveLayoutState({ width: window.innerWidth, sidebarExpanded: loggedUser.sidebarExpanded }),
}
const store = createStore((state = initialState, action) => {
    if (action.type === 'loading') return { ...state, showLoadingDataSpinner: action.value }
    if (action.type === 'resize')
        return {
            ...state,
            ...getResponsiveLayoutState({
                width: window.innerWidth,
                sidebarExpanded: state.loggedUser.sidebarExpanded,
            }),
        }
    return state
})
window.addEventListener('resize', () => store.dispatch({ type: 'resize' }))
window.setLoading = value => store.dispatch({ type: 'loading', value })
function ReferenceAction() {
    const { safeAreaInsets } = useModalSizing()
    return (
        <View
            testID="reference-add-task-button"
            style={{
                position: 'absolute',
                right: FLOATING_ACTION_VIEWPORT_GAP + safeAreaInsets.right,
                bottom: getFloatingActionBottom(safeAreaInsets.bottom),
                width: FLOATING_ACTION_SIZE,
                height: FLOATING_ACTION_SIZE,
                borderRadius: 28,
                backgroundColor: '#007FFF',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <Text style={{ color: 'white', fontSize: 32 }}>+</Text>
        </View>
    )
}
function Demo() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const sidebarWidth =
        mobile || loggedUser.isAnonymous || isAnnaMode()
            ? 0
            : loggedUser.sidebarExpanded
              ? SIDEBAR_MENU_WIDTH
              : SIDEBAR_MENU_COLLAPSED_WIDTH
    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <LoadingData />
            <View nativeID="sidebar" style={{ width: sidebarWidth, backgroundColor: '#071D43', overflow: 'hidden' }}>
                <Text style={{ color: 'white', fontSize: 20 }}>Alldone</Text>
            </View>
            <CustomScrollView nativeID="main-content" fixedChildren={<ReferenceAction />}>
                <View style={{ height: 1800, overflow: 'hidden' }}>
                    <Text style={{ fontSize: 24 }}>Background activity indicator</Text>
                    <Text style={{ marginTop: 16 }}>
                        Real LoadingData and CustomScrollView, with the shared “+” button geometry and responsive
                        sidebar footprint.
                    </Text>
                </View>
            </CustomScrollView>
        </View>
    )
}
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Demo />
    </Provider>
)
