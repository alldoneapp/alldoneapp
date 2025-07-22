import React, { useState, forwardRef, useImperativeHandle } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import AddAssistant from './AddAssistant'
import AddAssistantModal from '../../UIComponents/FloatModals/AddAssistantModal/AddAssistantModal'

const AddAssistantWrapper = forwardRef(({ project }, ref) => {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    useImperativeHandle(ref, () => ({
        openModal,
    }))

    return (
        <Popover
            content={<AddAssistantModal project={project} closeModal={closeModal} />}
            align={'start'}
            position={['top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={null}
        >
            <AddAssistant onPress={openModal} />
        </Popover>
    )
})

export default AddAssistantWrapper
