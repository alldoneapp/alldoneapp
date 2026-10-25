import React from 'react'
import renderer from 'react-test-renderer'
import { Text } from 'react-native'

import DateTag from './DateTag'

const mockState = {
    smallScreenNavigation: true,
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../Icon', () => 'Icon')
jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {}, caption1: {} },
    colors: { Gray300: '#ddd', Text03: '#333', UtilityBlue200: '#00f' },
    windowTagStyle: () => ({}),
}))

describe('DateTag mobile date visibility', () => {
    test('keeps the compact icon-only behavior by default', () => {
        const tree = renderer.create(<DateTag date="30.09.2026" />)

        expect(tree.root.findAllByType(Text)).toHaveLength(0)

        tree.unmount()
    })

    test('shows the date on mobile when the caller opts in', () => {
        const tree = renderer.create(<DateTag date="30.09.2026" showDateOnMobile={true} />)

        expect(tree.root.findByType(Text).props.children).toBe('30.09.2026')

        tree.unmount()
    })
})
