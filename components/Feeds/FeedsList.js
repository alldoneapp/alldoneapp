import React from 'react'
import { StyleSheet, View } from 'react-native'

import ContactObject from './FeedsObjects/ContactObject'
import TaskObject from './FeedsObjects/TaskObject'
import GoalObject from './FeedsObjects/GoalObject'
import ProjectObject from './FeedsObjects/ProjectObject'
import UserObject from './FeedsObjects/UserObject'
import NoteObject from './FeedsObjects/NoteObject'
import DateLine from './Commons/DateLine'
import SkillObject from './FeedsObjects/SkillObject'
import AssistantObject from './FeedsObjects/AssistantObject'

export default function FeedsList({ projectId, feedObjects, feedViewData, feedActiveTab, date }) {
    return (
        <View style={{ marginBottom: 16 }}>
            <DateLine date={date} />
            {feedObjects.map((feedObjectData, index) => {
                const { object } = feedObjectData
                const { type } = object
                let feedComponent = null
                let customIndex = 'i_'
                const style = index !== feedObjects.length - 1 ? localStyles.feed : null

                if (type === 'user') {
                    customIndex = `user_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <UserObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedActiveTab={feedActiveTab}
                            viewType={feedViewData.type}
                            style={style}
                        />
                    )
                } else if (type === 'task') {
                    customIndex = `task_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <TaskObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'goal') {
                    customIndex = `goal_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <GoalObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'assistant') {
                    customIndex = `assistant_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <AssistantObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'skill') {
                    customIndex = `skill_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <SkillObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'project') {
                    customIndex = `project_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <ProjectObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'contact') {
                    customIndex = `contact_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <ContactObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'note') {
                    customIndex = `note_${JSON.stringify(feedObjectData.object)}`
                    feedComponent = (
                        <NoteObject
                            key={`${index}_${customIndex}`}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                }

                return feedComponent
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    feed: {
        marginBottom: 24,
    },
})
