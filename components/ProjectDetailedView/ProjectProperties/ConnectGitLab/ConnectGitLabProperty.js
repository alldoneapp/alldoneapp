import React, { useState, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectGitLabModal from './ConnectGitLabModal/ConnectGitLabModal'
import ConnectGitLabButton from './ConnectGitLabButton'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { popoverToSafePosition } from '../../../../utils/HelperFunctions'
import { getGitlabUserConnection } from '../../../../utils/backends/firestore'

export default function ConnectGitLabProperty({ project, disabled }) {
    const dispatch = useDispatch()
    const projectId = project.id
    const userId = useSelector(state => state.loggedUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)
    const [hasToken, setHasToken] = useState(false)
    const [repoUrl, setRepoUrl] = useState(project.gitlabRepoUrl || '')

    const repoConnected = !!(repoUrl && repoUrl.trim())
    const connected = repoConnected && hasToken

    const refreshConnection = connectionUpdate => {
        if (connectionUpdate) {
            if ('repoUrl' in connectionUpdate) setRepoUrl(connectionUpdate.repoUrl || '')
            if ('connected' in connectionUpdate) setHasToken(!!connectionUpdate.connected)
        }
        getGitlabUserConnection(projectId, userId).then(c => setHasToken(!!(c && c.connected)))
    }

    useEffect(() => {
        refreshConnection()
    }, [projectId, userId])

    useEffect(() => {
        setRepoUrl(project.gitlabRepoUrl || '')
    }, [project.gitlabRepoUrl])

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
                <ConnectGitLabModal
                    project={project}
                    closePopover={closeModal}
                    onConnectionChange={refreshConnection}
                />
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
            <ConnectGitLabButton projectId={projectId} disabled={disabled} connected={connected} onPress={openModal} />
        </Popover>
    )
}
