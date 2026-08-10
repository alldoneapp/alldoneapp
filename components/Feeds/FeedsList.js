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

// `customIndex` used to embed `JSON.stringify(feedObjectData.object)`. That serialized every feed
// object on every render, and because any field change produced a different key React unmounted and
// remounted the whole card - tearing down and re-creating the Firestore listeners each card opens.
// The object id is unique inside a date bucket, so it identifies the card without either cost.
export default function FeedsList({ projectId, feedObjects, feedViewData, feedActiveTab, date }) {
    return (
        <View style={{ marginBottom: 16 }}>
            <DateLine date={date} />
            {feedObjects.map((feedObjectData, index) => {
                const { object } = feedObjectData
                const { type } = object
                let feedComponent = null
                let customIndex = `i_${index}`
                const style = index !== feedObjects.length - 1 ? localStyles.feed : null

                if (type === 'user') {
                    customIndex = `user_${object.id}`
                    feedComponent = (
                        <UserObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedActiveTab={feedActiveTab}
                            viewType={feedViewData.type}
                            style={style}
                        />
                    )
                } else if (type === 'task') {
                    customIndex = `task_${object.id}`
                    feedComponent = (
                        <TaskObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'goal') {
                    customIndex = `goal_${object.id}`
                    feedComponent = (
                        <GoalObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'assistant') {
                    customIndex = `assistant_${object.id}`
                    feedComponent = (
                        <AssistantObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'skill') {
                    customIndex = `skill_${object.id}`
                    feedComponent = (
                        <SkillObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'project') {
                    customIndex = `project_${object.id}`
                    feedComponent = (
                        <ProjectObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'contact') {
                    customIndex = `contact_${object.id}`
                    feedComponent = (
                        <ContactObject
                            key={customIndex}
                            feedObjectData={feedObjectData}
                            projectId={projectId}
                            feedViewData={feedViewData}
                            feedActiveTab={feedActiveTab}
                            style={style}
                        />
                    )
                } else if (type === 'note') {
                    customIndex = `note_${object.id}`
                    feedComponent = (
                        <NoteObject
                            key={customIndex}
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
