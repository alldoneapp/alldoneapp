import React from 'react'
import ImagePickerModal from '../../components/UIComponents/FloatModals/ImagePickerModal'

import renderer from 'react-test-renderer'

describe('ImagePickerModal component', () => {
    describe('ImagePickerModal snapshot test', () => {
        xit('Should render correctly', () => {
            const tree = renderer.create(<ImagePickerModal closePopover={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
