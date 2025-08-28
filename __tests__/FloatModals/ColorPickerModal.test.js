import React from 'react'
import ColorPickerModal from '../../components/UIComponents/FloatModals/ColorPickerModal'

import renderer from 'react-test-renderer'
import { colors } from '../../components/styles/global'

describe('ColorPickerModal component', () => {
    describe('ColorPickerModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<ColorPickerModal closePopover={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function selectColor snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(<ColorPickerModal selectColor={() => {}} closePopover={() => {}} />)

            tree.getInstance().selectColor(colors.ProjectColor400)
            expect(tree.toJSON()).toMatchSnapshot()

            const state = tree.getInstance().state
            expect(state.selectedColor).toEqual(colors.ProjectColor400)
        })
    })
})
