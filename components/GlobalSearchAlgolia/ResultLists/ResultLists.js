import React from 'react'
import { StyleSheet, View } from 'react-native'

import Header from '../Header/Header'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../../Feeds/CommentsTextInput/textInputHelper'
import TaskResults from './Tasks/TaskResults'
import EmptyResults from './Common/EmptyResults'
import CustomScrollView from '../../UIControls/CustomScrollView'
import GoalResults from './Goals/GoalResults'
import NoteResults from './Notes/NoteResults'
import Spinner from '../../UIComponents/Spinner'
import { colors } from '../../styles/global'
import ContactResults from './Contacts/ContactResults'
import ChatsResults from './Chats/ChatsResults'

export default function ResultLists({
    projects,
    tasksResultAmount,
    tasksResult,
    goalsResultAmount,
    goalsResult,
    notesResultAmount,
    notesResult,
    contactsResultAmount,
    contactsResult,
    chatsResultAmount,
    chatsResult,
    processing,
    activeItemData,
    activeTab,
    setActiveTab,
    activeItemRef,
    scrollRef,
    resultsContainerRef,
    showShortcuts,
    indexing,
}) {
    const showEmptyResult = () => {
        if (activeTab === MENTION_MODAL_TASKS_TAB && tasksResultAmount > 0) {
            return false
        } else if (activeTab === MENTION_MODAL_GOALS_TAB && goalsResultAmount > 0) {
            return false
        } else if (activeTab === MENTION_MODAL_NOTES_TAB && notesResultAmount > 0) {
            return false
        } else if (activeTab === MENTION_MODAL_CONTACTS_TAB && contactsResultAmount > 0) {
            return false
        } else if (activeTab === MENTION_MODAL_TOPICS_TAB && chatsResultAmount > 0) {
            return false
        }
        return true
    }

    return (
        <View style={localStyles.container}>
            <Header
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                tasksResultAmount={tasksResultAmount}
                goalsResultAmount={goalsResultAmount}
                notesResultAmount={notesResultAmount}
                contactsResultAmount={contactsResultAmount}
                chatsResultAmount={chatsResultAmount}
                showShortcuts={showShortcuts}
            />

            {processing[activeTab] ? (
                <View style={localStyles.spinnerContainer}>
                    <Spinner containerSize={48} spinnerSize={48} containerColor={colors.Secondary400} />
                </View>
            ) : indexing ? (
                <EmptyResults text={'Indexing data'} />
            ) : showEmptyResult() ? (
                <EmptyResults />
            ) : (
                <CustomScrollView ref={scrollRef} indicatorStyle={{ right: 6 }}>
                    <View ref={resultsContainerRef}>
                        {(() => {
                            switch (activeTab) {
                                case MENTION_MODAL_TASKS_TAB: {
                                    return (
                                        <TaskResults
                                            activeTab={activeTab}
                                            tasksResult={tasksResult}
                                            activeItemData={activeItemData}
                                            activeItemRef={activeItemRef}
                                            projects={projects}
                                        />
                                    )
                                }
                                case MENTION_MODAL_GOALS_TAB: {
                                    return (
                                        <GoalResults
                                            activeTab={activeTab}
                                            goalsResult={goalsResult}
                                            activeItemData={activeItemData}
                                            activeItemRef={activeItemRef}
                                            projects={projects}
                                        />
                                    )
                                }
                                case MENTION_MODAL_NOTES_TAB: {
                                    return (
                                        <NoteResults
                                            activeTab={activeTab}
                                            notesResult={notesResult}
                                            activeItemData={activeItemData}
                                            activeItemRef={activeItemRef}
                                            projects={projects}
                                        />
                                    )
                                }
                                case MENTION_MODAL_CONTACTS_TAB: {
                                    return (
                                        <ContactResults
                                            contactsResult={contactsResult}
                                            activeItemData={activeItemData}
                                            activeItemRef={activeItemRef}
                                            projects={projects}
                                        />
                                    )
                                }
                                case MENTION_MODAL_TOPICS_TAB: {
                                    return (
                                        <ChatsResults
                                            activeTab={activeTab}
                                            chatsResult={chatsResult}
                                            activeItemData={activeItemData}
                                            activeItemRef={activeItemRef}
                                            projects={projects}
                                        />
                                    )
                                }
                            }
                        })()}
                    </View>
                </CustomScrollView>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
        marginHorizontal: -16,
    },
    spinnerContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
