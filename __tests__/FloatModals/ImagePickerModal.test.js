import React from 'react'
import { Image } from 'react-native'
import ImagePickerModal, {
    ImagePickerModal as ImagePickerModalBase,
} from '../../components/UIComponents/FloatModals/ImagePickerModal'
import * as ImagePicker from '../../utils/WebShims/ImagePicker'

import renderer from 'react-test-renderer'

describe('ImagePickerModal component', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('ImagePickerModal snapshot test', () => {
        xit('Should render correctly', () => {
            const tree = renderer.create(<ImagePickerModal closePopover={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    it('ignores an image-size callback after the modal has unmounted', async () => {
        jest.spyOn(ImagePicker, 'launchImageLibraryAsync').mockResolvedValue({
            cancelled: false,
            uri: 'data:image/png;base64,aW1hZ2U=',
        })

        let finishSizing
        jest.spyOn(Image, 'getSize').mockImplementation((uri, onSuccess) => {
            finishSizing = onSuccess
        })

        const modal = new ImagePickerModalBase({})
        modal._isMounted = true
        modal.setState = jest.fn()

        await modal.pickImage()
        modal._isMounted = false

        expect(() => finishSizing(100, 100)).not.toThrow()
        expect(modal.setState).not.toHaveBeenCalled()
        expect(modal.actionButton.current).toBeNull()

        modal.state.unsubscribe()
    })
})
