import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'
import { TaskHierarchyBackgroundContext } from '../../components/TaskListView/TaskHierarchy'
import SwipeableGeneralTasksHeader from '../../components/TaskListView/OpenTasksView/SwipeableGeneralTasksHeader'

const project = { id: 'project-1', name: 'Alldone Consulting', color: PROJECT_COLOR_DEFAULT, index: 0 }
const surface = PROJECT_COLOR_SYSTEM[project.color].PROJECT_ITEM_SECTION

store.dispatch({
    type: 'Set anonymous sesion data',
    project,
    users: [],
    workstreams: [],
    contacts: [],
    assistants: [],
    globalAssistants: [],
    administratorUser: {},
})

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <TaskHierarchyBackgroundContext.Provider value={surface}>
            <View style={{ width: '100%', padding: 16, backgroundColor: surface }}>
                <View testID="general-tasks-row">
                    <SwipeableGeneralTasksHeader projectId={project.id} taskList={[{ id: 'task-1' }]} />
                </View>
            </View>
        </TaskHierarchyBackgroundContext.Provider>
    </Provider>
)

window.__expectedSurface = surface
