import React from 'react'
import { Provider } from 'react-redux'
import SocialText from '../components/UIControls/SocialText/SocialText'
import store from '../redux/store'

import renderer from 'react-test-renderer'
import { nodeMockOptions } from '../testUtils/domNodeStub'

jest.mock('firebase', () => ({ firestore: {} }))

// The hashtag/mention tags' effects now really run under react-native-web and
// reach the firestore watchers, whose `db` is never initialized in tests.
// Object.create keeps the real module on the prototype (spreading it would
// eagerly evaluate re-export getters mid-circular-import and crash).
jest.mock('../utils/backends/firestore', () =>
    Object.assign(Object.create(jest.requireActual('../utils/backends/firestore')), {
        watchHastagsColors: jest.fn(),
        unwatchHastagsColors: jest.fn(),
    })
)

const testString = '@mention #hashtag email@gmail.com https://a.com Normal text'
describe('SocialText component', () => {
    describe('SocialText snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <SocialText>{testString}</SocialText>
                    </Provider>,
                    nodeMockOptions
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
