import React, { useEffect, useLayoutEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import EmbeddedAppFrame from './EmbeddedAppFrame'
import { buildHandoffFrameUrl, createHandoffChannel, HANDOFF_TIMEOUT_MS, TEAM_ORIGIN } from './embeddedToolHandoff'
import { resolveReportedLocation } from './embeddedAppLocation'
import { translate } from '../../../../i18n/TranslationService'
import { buildEmbeddedToolWindowUrl } from '../../../../utils/embeddedToolWindowUrl'

const showToolAddress = url => {
    const address = buildEmbeddedToolWindowUrl(url)
    if (address && address !== window.location.href) window.history.replaceState(window.history.state, '', address)
}

export function EmbeddedToolWindowScreen({ navigation }) {
    const user = useSelector(state => state.loggedUser)
    const loggedIn = useSelector(state => state.loggedIn)
    useEffect(() => {
        if (loggedIn === false) navigation.navigate('LoginScreen')
    }, [loggedIn, navigation])

    if (!loggedIn || !user.uid || user.isAnonymous) return null
    const { url, handoffId } = navigation.state.params
    return <EmbeddedToolWindow key={user.uid} id={handoffId} url={url} userId={user.uid} />
}

export default function EmbeddedToolWindow({ id, url, userId }) {
    const [checkpoint, setCheckpoint] = useState(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        if (!id) return
        let channel
        try {
            channel = createHandoffChannel(id)
        } catch (error) {
            setFailed(true)
            return
        }

        let finished = false
        const finish = success => {
            if (finished) return
            finished = true
            clearTimeout(timeout)
            channel.postMessage({ type: success ? 'restored' : 'failed', userId })
            channel.close()
            if (!success) setFailed(true)
        }
        const timeout = setTimeout(() => finish(false), HANDOFF_TIMEOUT_MS)
        channel.onmessage = ({ data }) => {
            if (data?.type === 'failed') finish(false)
            if (data?.type === 'checkpoint') {
                const url = resolveReportedLocation(data.payload?.url, TEAM_ORIGIN)
                if (!buildEmbeddedToolWindowUrl(url)) finish(false)
                else setCheckpoint({ ...data.payload, url, finish })
            }
        }
        channel.postMessage({ type: 'ready', userId })

        return () => {
            clearTimeout(timeout)
            finished = true
            channel.close()
        }
    }, [id, userId])

    const toolUrl = checkpoint?.url ?? url
    useLayoutEffect(() => {
        if (!id || checkpoint || failed) showToolAddress(toolUrl)
    }, [id, checkpoint, failed, toolUrl])

    if (failed) return <p role="alert">{translate('embedded_tool_handoff_failed')}</p>
    if (!toolUrl || (id && !checkpoint)) return <p role="status">{translate('embedded_tool_handoff_loading')}</p>
    return (
        <div style={{ display: 'flex', position: 'fixed', inset: 0 }}>
            <EmbeddedAppFrame
                url={checkpoint ? buildHandoffFrameUrl(toolUrl, id) : toolUrl}
                title={checkpoint?.title}
                onLocationChange={showToolAddress}
                handoffRestore={checkpoint ? { id, onRestored: checkpoint.finish } : undefined}
            />
        </div>
    )
}
