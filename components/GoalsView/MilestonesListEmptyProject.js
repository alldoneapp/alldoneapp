import React from 'react'
import { View } from 'react-native'

import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import AddGoals from './AddGoals'
import GoalsBacklogHeader from './GoalsBacklogHeader'
import { GOALS_OPEN_TAB_INDEX } from './GoalsHelper'

export default function MilestonesListEmptyProject({
    projectId,
    projectIndex,
    setDismissibleRefs,
    closeEdition,
    openEdition,
    backlogId,
    goalsActiveTab,
}) {
    const inOpenTab = goalsActiveTab === GOALS_OPEN_TAB_INDEX

    return (
        <View>
            <ProjectHeader projectIndex={projectIndex} projectId={projectId} showAddGoal={inOpenTab} />

            {inOpenTab ? (
                <>
                    <GoalsBacklogHeader
                        projectId={projectId}
                        previousMilestoneDate={0}
                        milestoneId={backlogId}
                        goals={[]}
                    />
                    <AddGoals
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={backlogId}
                        milestoneDate={BACKLOG_DATE_NUMERIC}
                        refId={`MainAdd${backlogId}_backlog`}
                    />
                </>
            ) : (
                <View style={{ marginBottom: 16 }} />
            )}
        </View>
    )
}
