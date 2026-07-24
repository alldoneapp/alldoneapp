import { useEffect } from 'react'
import { useSelector } from 'react-redux'

import { listEmailConnections } from '../../../utils/IntegrationProviders'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'
import { buildLabelOptionMaps, mergeLabelsAcrossConnections } from './emailLineHelper'

// Reads every connected email account's cached summary from redux, ensures they're fetched
// (idempotent — the backend has a per-connection cooldown), and returns the labels merged
// across accounts. This is the same data the standalone Email line uses; header chips derive
// from it and split by group.projectId (set server-side from the labeling config) so a project
// label lands on its project line and Ads/No label land on the All Projects line.
//
// Self-contained fetch means the header chips work in the single-project open-tasks view too,
// where the Email line (and its fetch) isn't rendered.
export default function useEmailLabelGroups() {
    const loggedUser = useSelector(state => state.loggedUser)
    const summariesByKey = useSelector(state => state.emailLineSummaryByProject) || {}

    const connections = listEmailConnections(loggedUser)
    const connectionIds = connections.map(connection => connection.connectionId)
    const connectionIdsKey = connectionIds.join(',')

    useEffect(() => {
        connectionIds.forEach(connectionId => fetchEmailLineSummary(connectionId))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionIdsKey])

    const groups = mergeLabelsAcrossConnections(connections, summariesByKey)
    const { labelOptionsByConnectionId, labelingDisabledByConnectionId } = buildLabelOptionMaps(
        connections,
        summariesByKey
    )

    return { groups, labelOptionsByConnectionId, labelingDisabledByConnectionId, connections }
}
