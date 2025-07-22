import React from 'react'
import Header from '../components/SidebarMenu/Header'

import renderer from 'react-test-renderer'

jest.mock('../utils/NavigationService')
jest.mock('firebase', () => ({ firestore: {} }))

const navigationMock = {
    navigate: () => {},
}

describe('Header component', () => {
    describe('Header snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Header navigation={navigationMock} scrollToTop={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('test component methods call', () => {
        it('after call onPressSettings should render correctly', () => {
            const tree = renderer.create(<Header navigation={navigationMock} scrollToTop={() => {}} />)
            const instance = tree.getInstance()
            instance.onPressSettings()
        })
    })
})
