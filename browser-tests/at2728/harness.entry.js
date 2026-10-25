import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { View } from 'react-native'

import AssistantProgress from '../../components/ChatsView/ChatDV/EditorView/AssistantProgress'
import StopAssistantRunButton from '../../components/ChatsView/ChatDV/EditorView/StopAssistantRunButton'
import { setLanguage } from '../../i18n/TranslationService'
import AnnaMessageAuthor from '../../components/Anna/AnnaMessageAuthor'
import Comment from '../../components/Feeds/FeedsModals/ListCommentsComponents/Comment'
import { creators } from './presentation'
import '../../components/Anna/anna.css'

setLanguage('de')
const store = createStore((state = { loggedUser: { uid: 'user-1' } }) => state)
const activityHistory = [
    { phase: 'thinking', startedAt: 1 },
    {
        phase: 'tool',
        toolName: 'create_task',
        actionKey: 'assistant_activity_create_task',
        subject: '„Stop“ in den schönen Loading Screen integrieren',
        startedAt: 2,
    },
]
const assistantRun = { kind: 'chat', status: 'running', runId: 'run-1', activityHistory }

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        {['light', 'dark'].map(appearance => (
            <View
                key={appearance}
                testID={`surface-${appearance}`}
                style={{ padding: 16, backgroundColor: appearance === 'dark' ? '#0B1F46' : '#FFFFFF' }}
            >
                {['anna', 'carl', 'unknown'].map(creatorId => (
                    <View key={creatorId} testID={`author-${appearance}-${creatorId}`}>
                        {appearance === 'light' ? (
                            <AnnaMessageAuthor
                                message={{ creatorId, created: Date.now() }}
                                creator={creators[creatorId]}
                            />
                        ) : (
                            <Comment
                                projectId="project-1"
                                comment={{ creatorId, commentText: '', lastChangeDate: Date.now() }}
                                contentOverride={<View />}
                            />
                        )}
                    </View>
                ))}
                <AssistantProgress
                    appearance={appearance}
                    activity={activityHistory[1]}
                    activityHistory={activityHistory}
                    runId={assistantRun.runId}
                >
                    <StopAssistantRunButton
                        projectId="project-1"
                        objectType="tasks"
                        objectId="task-1"
                        commentId="comment-1"
                        assistantRun={assistantRun}
                        isLoading={true}
                        appearance={appearance}
                        variant="card"
                    />
                </AssistantProgress>
            </View>
        ))}
    </Provider>
)
