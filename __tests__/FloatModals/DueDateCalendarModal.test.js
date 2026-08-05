import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import DueDateCalendarModal from '../../components/UIComponents/FloatModals/DueDateCalendarModal/DueDateCalendarModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import moment from 'moment'

// The modal hands react-native-calendars a default locale taken from
// loggedUser.language, which only the login flow populates. Without it xdate
// looks up an undefined locale and throws while formatting month names. The
// third-party calendar is not what this suite covers.
jest.mock('react-native-calendars', () => ({
    Calendar: 'Calendar',
    LocaleConfig: { locales: {}, defaultLocale: 'en' },
}))

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

describe('DueDateCalendarModal component', () => {
    describe('DueDateCalendarModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <DueDateCalendarModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
