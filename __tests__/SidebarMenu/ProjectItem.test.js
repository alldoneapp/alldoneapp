import React from 'react'
import ProjectItem from '../../components/SidebarMenu/ProjectFolding/ProjectItem/ProjectItem'
import store from '../../redux/store'
import { storeLoggedUserProjects, switchProject, setNavigationRoute } from '../../redux/actions'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { ALL_PROJECTS_INDEX } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('../../utils/NavigationService')
jest.mock('firebase', () => ({ firestore: {} }));

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn()
}));

const dummyUserId = 'UUKU61Jc7ET8zE5ncN8F61HE19y1'
const dummyProject = {
    item: {
        index: 0,
        id: '-LcRVRo6mhbC0oXCcZ2F',
        color: '#39CCCC',
        name: 'Another one',
        tasksAmount: 6,
        tasks: [],
        tags: {},
        userIds: [
            'C08CK8x1I5YS2lxVixuLHaF3SrA3',
            'XVbBpdTHCfdo17bCqRrnGV85oJI2',
            's7jsNunUq6OQZttrrSyRO05MVFI2',
            'jsUAwtuUhfPrQwPFMtDyKAsdo7g1',
            'UUKU61Jc7ET8zE5ncN8F61HE19y1',
            'kTpVkeDAGMO7qIHvQ2uAbEUu0As1',
        ],
    },
    index: 0,
    separators: {},
}

describe('ProjectItem component', () => {
    describe('ProjectItem snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectItem project={dummyProject} loggedUserId={dummyUserId} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when it is highlighted', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectItem index={ALL_PROJECTS_INDEX} project={dummyProject} loggedUserId={dummyUserId} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('ProjectItem methods', () => {
        it('should correctly handle navigation with browsing history', () => {
            // Given
            const navigation = {
                closeDrawer: () => { },
            }
            const tree = renderer.create(
                <ProjectItem project={dummyProject} loggedUserId={dummyUserId} navigation={navigation} />
            )
            const instance = tree.getInstance()
            window.location = { pathname: '/stairway/to/heaven', origin: 'https://zeppelin.com' }
            window.hist = []
            history = {
                pushState: (state, title, url) => {
                    window.hist.push({ state: state, title: title, url: url })
                },
            }
            store.dispatch(setNavigationRoute('Heaven?'))
            store.dispatch(switchProject(0))
            store.dispatch(storeLoggedUserProjects([{ name: 'Build a Stairway To Heaven', id: '0' }]))
            // When
            instance.onPress({ preventDefault: () => { } })
            // Then
            expect(window.hist).toBeTruthy()
        })
    })
})
