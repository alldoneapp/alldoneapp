import React, { useEffect } from 'react'

import MeetingTimeStatistics from '../../MeetingReview/MeetingTimeStatistics'
import URLsProjects, { URL_PROJECT_DETAILS_MEETING_TIME } from '../../../URLSystem/Projects/URLsProjects'

/**
 * AT-3145 — Project details → Meeting time: the Settings → Meeting time statistics narrowed to this
 * project. Still the signed-in user's own appointments and private ratings only; other members of
 * the project never see them (see MeetingTimeStatistics).
 */
const ProjectMeetingTimeView = ({ project, userId }) => {
    useEffect(() => {
        URLsProjects.push(URL_PROJECT_DETAILS_MEETING_TIME, { projectId: project.id, userId }, project.id)
    }, [project.id, userId])

    return <MeetingTimeStatistics projectId={project.id} />
}

export default ProjectMeetingTimeView
