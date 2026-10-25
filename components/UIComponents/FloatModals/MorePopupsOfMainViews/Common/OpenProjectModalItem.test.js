/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import OpenProjectModalItem from './OpenProjectModalItem'
import NavigationService from '../../../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../../../redux/actions'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ loggedUserProjectsMap: { 'project-1': { index: 7 } } }),
}))
jest.mock('../../MorePopupsOfEditModals/Common/ModalItem', () => 'ModalItem')
jest.mock('../../GoalMilestoneModal/Line', () => 'MenuLine')
jest.mock('../../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../../../redux/actions', () => ({
    setSelectedNavItem: jest.fn(tab => ({ type: 'SET_SELECTED_NAV_ITEM', tab })),
}))

describe('OpenProjectModalItem', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('opens the project properties and dismisses its parent menu', () => {
        const onPress = jest.fn()
        const tree = renderer.create(<OpenProjectModalItem projectId="project-1" shortcut="1" onPress={onPress} />)
        const item = tree.root.findByType('ModalItem')

        expect(item.props).toMatchObject({ icon: 'folder-open', text: 'Open Project', shortcut: '1' })
        expect(tree.root.findAllByType('MenuLine')).toHaveLength(1)

        act(() => item.props.onPress())

        expect(setSelectedNavItem).toHaveBeenCalledWith('PROJECT_PROPERTIES')
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_NAV_ITEM', tab: 'PROJECT_PROPERTIES' })
        expect(NavigationService.navigate).toHaveBeenCalledWith('ProjectDetailedView', { projectIndex: 7 })
        expect(onPress).toHaveBeenCalledTimes(1)
    })
})
