import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import CustomFollowUpDateModal from '../../components/FollowUp/CustomFollowUpDateModal'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('CustomFollowUpDateModal component', () => {
    describe('CustomFollowUpDateModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <CustomFollowUpDateModal
                            hidePopover={() => {}}
                            selectDate={() => {}}
                            backToDueDate={() => {}}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
