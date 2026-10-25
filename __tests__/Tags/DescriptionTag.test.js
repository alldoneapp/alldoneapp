import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import DescriptionTag from '../../components/Tags/DescriptionTag'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ mobile: false, isMiddleScreen: false }),
}))
jest.mock('react-tiny-popover', () => 'Popover')
jest.mock('../../components/Icon', () => 'Icon')
jest.mock('../../components/styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: { Gray300: '#eee', Text03: '#333', UtilityBlue200: '#00f' },
    windowTagStyle: () => ({}),
    // components/styles/modals.js calls this at module load (AppPopover chain).
    hexColorToRGBa: (color, alpha) => `rgba(0,0,0,${alpha})`,
}))
jest.mock('../../components/UIComponents/FloatModals/DescriptionModal/DescriptionModal', () => 'DescriptionModal')
jest.mock('../../functions/Utils/parseTextUtils', () => ({
    cleanTextMetaData: text => text,
    shrinkTagText: text => text,
}))

describe('DescriptionTag popup lock', () => {
    test('releases its task-row popup contribution when the row unmounts', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <DescriptionTag
                    projectId="project-1"
                    object={{ id: 'task-1', description: 'Task details' }}
                    objectType="tasks"
                />
            )
        })

        act(() => {
            tree.root.findByType(TouchableOpacity).props.onPress()
        })
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Show float popup' })

        act(() => {
            tree.unmount()
        })
        expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'Hide float popup' })
    })
})
