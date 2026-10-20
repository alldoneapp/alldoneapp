import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'
import LoggedUserSidebar from './LoggedUserSidebar/LoggedUserSidebar'
import DismissibleModal from '../UIComponents/DismissibleModal'
import store from '../../redux/store'
import { setAnnaMode, isAnnaMode } from '../../utils/annaMode'

jest.mock('../../redux/store', () => {
    // Keep real subscriptions and batched actions, without loading Firebase.
    const { createStore } = require('redux')
    const store = createStore((state = {}, action) => {
        switch (action.type) {
            case 'Override store':
                return action.store
            case 'Switch project':
                return { ...state, selectedProjectIndex: action.index }
            case 'Hide web side bar':
                return { ...state, showWebSideBar: { ...state.showWebSideBar, visible: false } }
            case 'Set show web side bar':
                return { ...state, showWebSideBar: { ...state.showWebSideBar, visible: true } }
            default:
                return state
        }
    })
    const dispatch = store.dispatch
    store.dispatch = action => (Array.isArray(action) ? action.forEach(dispatch) : dispatch(action))
    return { __esModule: true, default: store }
})
jest.mock('./LoggedUserSidebar/LoggedUserSidebarHeader', () => () => null)
jest.mock('./LoggedUserSidebar/LoggedUserSidebarBody', () => () => {
    const ProjectItem = require('./ProjectFolding/ProjectItem/ProjectItem').default
    return [0, 1].map(index => (
        <ProjectItem
            key={index}
            itemIndex={index}
            projectData={{ id: `p${index}`, index, name: `Project ${index}`, color: '#39CCCC' }}
            projectType="active"
        />
    ))
})
jest.mock('./ProjectFolding/ProjectItem/ProjectItemIcon', () => () => null)
jest.mock('./ProjectFolding/ProjectItem/ProjectItemName', () => ({ projectName }) => <span>{projectName}</span>)
jest.mock('./ProjectFolding/ProjectItem/ProjectRightArea', () => () => null)
jest.mock('./ProjectFolding/ProjectSectionList', () => () => null)
jest.mock('./Themes', () => ({
    Themes: {
        modern: {
            CustomSideMenu: { ProjectList: { ProjectItem: { container: () => ({}), containerActive: () => ({}) } } },
        },
    },
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ checkIfSelectedProject: index => index >= 0 }))
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../utils/backends/Users/usersFirestore', () => ({ updateShowAllProjectsByTime: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))

let root, mount
const emptyPopup = { visible: false }
const pointerDown = (pageX, pageY) => {
    // AppContainer forwards the document's capture-phase mousedown this way.
    // Flush it before click, as separate browser input events would be flushed.
    act(() => DismissibleModal.captureDismissibleTouch({ persist() {}, nativeEvent: { pageX, pageY } }))
}
const rect = (left, top = 32, width = 263, height = 900) => ({ left, top, width, height })
const SidebarFixture = () => {
    const visible = useSelector(state => state.showWebSideBar.visible)
    return visible ? <LoggedUserSidebar expanded containerStyle={{}} /> : null
}
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    const user = { uid: 'u1', themeName: 'modern', sidebarExpanded: true }
    store.dispatch({
        type: 'Override store',
        store: {
            loggedUser: user,
            currentUser: user,
            selectedProjectIndex: 0,
            smallScreenNavigation: true,
            route: 'Root',
            dismissibleComponent: null,
            showWebSideBar: { visible: true, layout: { x: 0, y: 0, width: 263, height: 1000 } },
            showAddProjectOptions: emptyPopup,
            showInviteUserOptions: emptyPopup,
            showProjectColorPicker: emptyPopup,
            showAssigneePicker: emptyPopup,
            showProjectPicker: emptyPopup,
            showDueDateCalendar: emptyPopup,
        },
    })
    mount = document.createElement('div')
    document.body.append(mount)
    root = createRoot(mount)
    act(() =>
        root.render(
            <Provider store={store}>
                <textarea aria-label="Assistant draft" defaultValue="Keep my message" />
                <SidebarFixture />
            </Provider>
        )
    )
})
afterEach(() => {
    act(() => root.unmount())
    mount.remove()
    jest.restoreAllMocks()
    window.history.replaceState(null, '', '/')
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it.each([0, 480, 610])('allows repeated project selection with sidebar origin %s', left => {
    setAnnaMode(left > 0)
    const chat = mount.querySelector('textarea')
    for (const index of [1, 0]) {
        act(() => store.dispatch({ type: 'Set show web side bar' }))
        const sidebar = document.getElementById('app-sidebar')
        jest.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(rect(left))
        const project = [...mount.querySelectorAll('span')].find(node => node.textContent === `Project ${index}`)
        pointerDown(left + 120, 200)
        expect(store.getState().showWebSideBar.visible).toBe(true)
        expect(project.isConnected).toBe(true)
        act(() => project.click())
        expect(store.getState().selectedProjectIndex).toBe(index)
        expect(store.getState().showWebSideBar.visible).toBe(false)
        expect(isAnnaMode()).toBe(left > 0)
        expect(mount.querySelector('textarea')).toBe(chat)
        expect(chat.value).toBe('Keep my message')
    }
})

it.each([
    [120, 200], // The assistant pane was previously mistaken for the sidebar.
    [800, 200], // Main app content.
    [600, 20], // Above the sidebar.
    [600, 950], // Below the sidebar.
])('dismisses the shifted sidebar on a real outside press at (%s, %s)', (x, y) => {
    jest.spyOn(document.getElementById('app-sidebar'), 'getBoundingClientRect').mockReturnValue(rect(480))
    pointerDown(x, y)
    expect(store.getState().showWebSideBar.visible).toBe(false)
})

it('uses live bounds after resizing and compares page coordinates when the document scrolls', () => {
    const bounds = jest.spyOn(document.getElementById('app-sidebar'), 'getBoundingClientRect')
    bounds.mockReturnValue(rect(480))
    pointerDown(600, 200)
    expect(store.getState().showWebSideBar.visible).toBe(true)
    bounds.mockReturnValue(rect(700, 50))
    jest.replaceProperty(window, 'scrollX', 20)
    jest.replaceProperty(window, 'scrollY', 100)
    pointerDown(850, 250)
    expect(store.getState().showWebSideBar.visible).toBe(true)
    pointerDown(600, 250)
    expect(store.getState().showWebSideBar.visible).toBe(false)
})

it('retains the stored-layout fallback when no measurable sidebar is mounted', () => {
    // jsdom has no layout; the rendered element reports a zero-sized rectangle.
    pointerDown(120, 200)
    expect(store.getState().showWebSideBar.visible).toBe(true)
    pointerDown(300, 200)
    expect(store.getState().showWebSideBar.visible).toBe(false)
})
