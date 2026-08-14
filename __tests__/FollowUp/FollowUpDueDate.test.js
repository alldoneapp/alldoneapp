import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import FollowUpDueDate from '../../components/FollowUp/FollowUpDueDate'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('FollowUpDueDate component', () => {
    describe('FollowUpDueDate snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <FollowUpDueDate
                            closePopover={() => {}}
                            selectDate={true}
                            onCustomDatePress={() => {}}
                            dateText="Today"
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <FollowUpDueDate
                            closePopover={() => {}}
                            selectDate={false}
                            onCustomDatePress={() => {}}
                            dateText="Today"
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
