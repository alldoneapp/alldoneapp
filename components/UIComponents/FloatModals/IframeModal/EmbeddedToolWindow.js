import React, { useEffect, useState } from 'react'
import EmbeddedAppFrame from './EmbeddedAppFrame'
import { buildHandoffFrameUrl, createHandoffChannel, HANDOFF_TIMEOUT_MS, TEAM_ORIGIN } from './embeddedToolHandoff'
import { resolveReportedLocation } from './embeddedAppLocation'
import { translate } from '../../../../i18n/TranslationService'

export default function EmbeddedToolWindow({ id, userId, onNavigateAway }) {
    const [checkpoint, setCheckpoint] = useState(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
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
                if (!url) finish(false)
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

    if (failed) return <p role="alert">{translate('embedded_tool_handoff_failed')}</p>
    if (!checkpoint) return <p role="status">{translate('embedded_tool_handoff_loading')}</p>
    return (
        <div style={{ display: 'flex', position: 'fixed', inset: 0 }}>
            <EmbeddedAppFrame
                url={buildHandoffFrameUrl(checkpoint.url, id)}
                title={checkpoint.title}
                onNavigateAway={onNavigateAway}
                handoffRestore={{ id, onRestored: checkpoint.finish }}
            />
        </div>
    )
}
