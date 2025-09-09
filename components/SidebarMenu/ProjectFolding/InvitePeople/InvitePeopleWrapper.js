import React, { useState, useEffect, useRef } from 'react'
import Popover from 'react-tiny-popover'

import InvitePeopleButton from './InvitePeopleButton'
import InvitePeopleModal from './InvitePeopleModal'

export default function InvitePeopleWrapper({ projectColor, projectIndex }) {
    const [isOpen, setIsOpen] = useState(false)
    const isUnmountedRef = useRef(false)

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) {
            setIsOpen(value)
        } else {
            console.debug('[InvitePeopleWrapper] Ignored setIsOpen after unmount')
        }
    }

    const openModal = () => {
        safeSetIsOpen(true)
    }

    const closeModal = () => {
        safeSetIsOpen(false)
    }

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
        }
    }, [])

    return (
        <>
            {isOpen ? (
                <Popover
                    content={<InvitePeopleModal projectIndex={projectIndex} closeModal={closeModal} />}
                    align={'start'}
                    position={['bottom']}
                    onClickOutside={closeModal}
                    disableReposition
                    isOpen
                >
                    <InvitePeopleButton projectColor={projectColor} openModal={openModal} />
                </Popover>
            ) : (
                <InvitePeopleButton projectColor={projectColor} openModal={openModal} />
            )}
        </>
    )
}
