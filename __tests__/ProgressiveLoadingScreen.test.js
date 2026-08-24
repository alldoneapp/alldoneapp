import React from 'react'
import renderer from 'react-test-renderer'

import ProgressiveLoadingScreen from '../components/ProgressiveLoadingScreen'

jest.mock('../components/TopBar/ConnectionStatusChip', () => 'ConnectionStatusChip')

describe('ProgressiveLoadingScreen', () => {
    it('renders a connection status while initial data is still loading', () => {
        const component = renderer.create(
            <ProgressiveLoadingScreen step={2} totalSteps={5} currentMessage={'Loading'} />
        )

        expect(component.root.findByType('ConnectionStatusChip').props.mobile).toBe(true)
    })
})
