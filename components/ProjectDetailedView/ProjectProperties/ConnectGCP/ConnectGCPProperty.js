import React, { useState, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectGCPModal from './ConnectGCPModal/ConnectGCPModal'
import ConnectGCPButton from './ConnectGCPButton'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { popoverToSafePosition } from '../../../../utils/HelperFunctions'
import { getGcpConnection } from '../../../../utils/backends/firestore'

export default function ConnectGCPProperty({ project, disabled }) {
    const dispatch = useDispatch()
    const projectId = project.id
    const userId = useSelector(state => state.loggedUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)
    const [connected, setConnected] = useState(false)

    // The connection is purely per-user (no shared project field), so state comes from the
    // user's own private gcpAuth doc.
    const refreshConnection = connectionUpdate => {
        if (connectionUpdate && 'connected' in connectionUpdate) setConnected(!!connectionUpdate.connected)
        getGcpConnection(projectId, userId).then(c => setConnected(!!(c && c.connected)))
    }

    useEffect(() => {
        refreshConnection()
    }, [projectId, userId])

    const openModal = () => {
        if (isOpenRef.current) return
        isOpenRef.current = true
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (!isOpenRef.current) return
        isOpenRef.current = false
        setIsOpen(false)
        dispatch(hideFloatPopup())
        refreshConnection()
    }

    useEffect(() => {
        return () => {
            if (isOpenRef.current) {
                isOpenRef.current = false
                dispatch(hideFloatPopup())
            }
        }
    }, [dispatch])

    return (
        <Popover
            content={
                <ConnectGCPModal project={project} closePopover={closeModal} onConnectionChange={refreshConnection} />
            }
            onClickOutside={closeModal}
            isOpen={isOpen}
            position={['right', 'bottom', 'left', 'top']}
            padding={4}
            windowBorderPadding={16}
            align={'end'}
            disableReposition={true}
            contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
            containerStyle={{
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: 'calc(100vh - 32px)',
                overflow: 'visible',
                zIndex: '9999',
            }}
        >
            <ConnectGCPButton projectId={projectId} disabled={disabled} connected={connected} onPress={openModal} />
        </Popover>
    )
}
