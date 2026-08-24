import React from 'react'
import LoadingScreen from '../components/LoadingScreen'

import renderer from 'react-test-renderer'

jest.mock('../components/TopBar/ConnectionStatusChip', () => 'ConnectionStatusChip')

describe('LoadingScreen component', () => {
    describe('LoadingScreen snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<LoadingScreen />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('renders the connection status while the app is still loading', () => {
            const component = renderer.create(<LoadingScreen />)

            expect(component.root.findByType('ConnectionStatusChip').props.mobile).toBe(true)
        })
    })
})
