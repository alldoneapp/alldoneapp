import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import { DragDropContext } from '@hello-pangea/dnd'

import AllProjectsEmptyInbox from '../../../TaskListView/OpenTasksView/AllProjectsEmptyInbox'
import MyDaySelectedTasks from './MyDaySelectedTasks'
import MoreTasksLine from './MoreTasksLine'
import MyDayOtherTasks from './MyDayOtherTasks'
import { setActiveDragTaskModeInMyDay } from '../../../../redux/actions'
import AllProjectsAssistantLine from '../../AssistantLine/AllProjectsAssistantLine'
import { onBeforeCapture, onDragEnd } from '../../../DragSystem/MyDayDragHelper'
import AllProjectsLine from '../../../TaskListView/Header/AllProjectsLine/AllProjectsLine'

export default function MyDayOpenTasks() {
    const dispatch = useDispatch()
    const selectedTasksAmount = useSelector(state => state.myDaySelectedTasks.length)
    const tasksLoaded = useSelector(state => state.myDayAllTodayTasks.loaded)
    const myDayOtherTasksAmount = useSelector(state => state.myDayOtherTasks.length)
    const myDayShowAllTasks = useSelector(state => state.myDayShowAllTasks)
    const activeDragTaskModeInMyDay = useSelector(state => state.activeDragTaskModeInMyDay)
    const myDaySortingOtherTasksAmount = useSelector(state => state.myDaySortingOtherTasks.length)

    useEffect(() => {
        return () => {
            dispatch(setActiveDragTaskModeInMyDay(false))
        }
    }, [])

    const needToShowEmptyBoardPicture = selectedTasksAmount === 0 && myDayOtherTasksAmount === 0
    const showMoreTaskLine = activeDragTaskModeInMyDay ? myDaySortingOtherTasksAmount > 0 : myDayOtherTasksAmount > 0
    // AT-2262: the congrats renders right under the assistant line (which also shows the
    // latest comment) instead of at the very bottom of the page, so it is visible without
    // scrolling — but it never pushes the assistant composer / last comment down.
    const showEmptyInbox = tasksLoaded && needToShowEmptyBoardPicture

    return (
        <>
            <AllProjectsLine />
            <AllProjectsAssistantLine />
            {/* AT-2445: My Day is where the last task of the day is usually ticked off, and until
                now clearing it here celebrated nothing — the congratulation appeared silently and
                the achievement card is not shown on this board at all. It celebrates on the same
                once-per-day marker as the all-projects board, so whichever you reach first plays it
                and the other does not repeat it. `tasksLoaded` has always guarded this render, which
                is what keeps a loading flash from spending the day. */}
            {showEmptyInbox && <AllProjectsEmptyInbox celebrateNewDay />}
            {!showEmptyInbox && (
                <DragDropContext onDragEnd={onDragEnd} onBeforeCapture={onBeforeCapture}>
                    <View style={{ marginTop: 16, marginBottom: 32 }}>
                        <>
                            <MyDaySelectedTasks />
                            <>
                                {showMoreTaskLine && <MoreTasksLine />}
                                {myDayShowAllTasks && (
                                    <>
                                        <MyDayOtherTasks />
                                        <MoreTasksLine />
                                    </>
                                )}
                            </>
                        </>
                    </View>
                </DragDropContext>
            )}
        </>
    )
}
