import { useEffect, useState } from 'react'
import moment from 'moment'

import {
    watchKnowledgeBase,
    watchKnowledgePages,
    watchKnowledgeRuns,
} from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

// `undefined` while the first snapshot is pending, `null` when the project has no wiki document.
export function useKnowledgeBaseDoc(projectId) {
    const [knowledgeBase, setKnowledgeBase] = useState(undefined)

    useEffect(() => {
        setKnowledgeBase(undefined)
        if (!projectId) return undefined
        return watchKnowledgeBase(projectId, setKnowledgeBase, () => setKnowledgeBase(null))
    }, [projectId])

    return knowledgeBase
}

export function useKnowledgePages(projectId) {
    const [state, setState] = useState({ pages: [], pendingRebuilds: 0, loaded: false })

    useEffect(() => {
        setState({ pages: [], pendingRebuilds: 0, loaded: false })
        if (!projectId) return undefined
        return watchKnowledgePages(
            projectId,
            (pages, { pendingRebuilds }) => setState({ pages, pendingRebuilds, loaded: true }),
            () => setState(current => ({ ...current, loaded: true }))
        )
    }, [projectId])

    return state
}

export function useKnowledgeRuns(projectId) {
    const [runs, setRuns] = useState([])

    useEffect(() => {
        setRuns([])
        if (!projectId) return undefined
        return watchKnowledgeRuns(projectId, setRuns)
    }, [projectId])

    return runs
}

export function isKnowledgeBaseRunning(knowledgeBase, now = Date.now()) {
    return !!knowledgeBase?.leaseOwner && Number(knowledgeBase.leaseExpiresAt) > now
}

export function formatWikiDate(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || !timestamp) return ''
    return moment(Number(timestamp)).format(`${getDateFormat()} ${getTimeFormat()}`)
}
