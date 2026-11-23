import React from 'react'
import { Provider } from 'react-redux'
import ProjectHeader from '../../../components/TaskListView/Header/ProjectHeader'
import store from '../../../redux/store'
import { storeCurrentUser, storeLoggedUser, toggleSmallScreenNavigation } from '../../../redux/actions'

import renderer from 'react-test-renderer'

describe('ProjectHeader component', () => {
    // These snapshots show the simple sidebar; since AT-3122 a user without a stored mode gets "Anna on top".
    beforeEach(() => store.dispatch(storeLoggedUser({ sidebarNavigationMode: 'simple' })))

    describe('ProjectHeader snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeCurrentUser({ workflow: [] }))
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectHeader user={{ photoURL: 'http://url.to.photo' }} project={{ color: '#0055ff' }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    // AT-3132: the selected project's line is centred on mobile sizes only; desktop stays left aligned.
    describe('selected project line, mobile vs desktop', () => {
        const findByTestID = (node, testID) => {
            if (!node || typeof node !== 'object') return null
            if (node.props && node.props['data-testid'] === testID) return node
            for (const child of [].concat(node.children || [])) {
                const found = findByTestID(child, testID)
                if (found) return found
            }
            return null
        }
        const renderSelected = mobile => {
            store.dispatch(storeCurrentUser({ workflow: [] }))
            store.dispatch(toggleSmallScreenNavigation(mobile))
            store.dispatch({ type: 'Switch project', index: 0 })
            return renderer
                .create(
                    <Provider store={store}>
                        <ProjectHeader projectIndex={0} projectId="p0" />
                    </Provider>
                )
                .toJSON()
        }

        afterEach(() => {
            store.dispatch(toggleSmallScreenNavigation(false))
            store.dispatch({ type: 'Switch project', index: -1 })
        })

        it('centres the title with a mirrored spacer on mobile', () => {
            const tree = renderSelected(true)
            expect(findByTestID(tree, 'project-line-mirror')).not.toBeNull()
            expect(findByTestID(tree, 'project-line-actions')).not.toBeNull()
            expect(tree).toMatchSnapshot()
        })

        it('keeps the title left aligned without a spacer on desktop', () => {
            const tree = renderSelected(false)
            expect(findByTestID(tree, 'project-line-mirror')).toBeNull()
            expect(findByTestID(tree, 'project-line-actions')).toBeNull()
            expect(findByTestID(tree, 'project-and-user-data')).not.toBeNull()
            expect(tree).toMatchSnapshot()
        })
    })
})
