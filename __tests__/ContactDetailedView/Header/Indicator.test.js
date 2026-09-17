/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform } from 'react-native'
import Indicator from '../../../components/ContactDetailedView/Header/Indicator'
import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('Detailed Project Indicator component', () => {
    describe('Detailed Project Indicator snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Indicator />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
