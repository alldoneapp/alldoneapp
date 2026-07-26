/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import UserGold from '../../../../components/SettingsView/Profile/Properties/UserGold'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: jest.fn(text => text),
}))

jest.mock('../../../../assets/svg/Gold', () => 'Gold')
jest.mock('../../../../components/Icon', () => 'Icon')

describe('UserGold', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector =>
            selector({
                smallScreenNavigation: false,
            })
        )
    })

    it('renders chevron only when the row is interactive', () => {
        const interactiveTree = renderer.create(<UserGold gold={7} onPress={() => {}} />)
        const staticTree = renderer.create(<UserGold gold={7} />)

        expect(interactiveTree.root.findAllByType('Icon')).toHaveLength(1)
        expect(staticTree.root.findAllByType('Icon')).toHaveLength(0)
    })
})
