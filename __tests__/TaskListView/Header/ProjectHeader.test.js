import React from 'react'
import { Provider } from 'react-redux'
import ProjectHeader from '../../../components/TaskListView/Header/ProjectHeader'
import store from '../../../redux/store'
import { storeCurrentUser } from '../../../redux/actions'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('ProjectHeader component', () => {
    describe('ProjectHeader snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeCurrentUser({ workflow: [] }))
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectHeader
                            user={{ photoURL: 'http://url.to.photo' }}
                            project={{ color: '#0055ff' }}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
