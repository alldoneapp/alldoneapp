import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'
import { TouchableOpacity, Text, View } from 'react-native'
import UpcomingMilestoneRow from '../../components/TaskListView/Header/UpcomingMilestoneRow'
import ProjectPostponeSwipe from '../../components/TaskListView/Header/ProjectPostponeSwipe'
import GlobalModalsContainerRootView from '../../components/UIComponents/GlobalModalsContainerRootView'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import store from './store'

window.__events = []
window.__writes = []
window.__state = () => store.getState()
for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
    document.addEventListener(type, event => window.__events.push({ type, target: event.target.tagName }), true)
}
function Harness() {
    const tab = useSelector(state => state.selectedSidebarTab)
    return (
        <View style={{ minHeight: '100vh' }}>
            <div style={{ maxWidth: 760, margin: '120px 16px' }}>
                {tab === DV_TAB_ROOT_TASKS ? (
                    <>
                        <div id="milestone">
                            <UpcomingMilestoneRow projectId="p1" allowProjectPostpone />
                        </div>
                        <div id="project" style={{ marginTop: 32 }}>
                            <ProjectPostponeSwipe projectId="p1">
                                <TouchableOpacity
                                    onPress={() => window.__events.push({ type: 'project-press' })}
                                    style={{ height: 64, backgroundColor: '#eee' }}
                                >
                                    <Text>Project control</Text>
                                </TouchableOpacity>
                            </ProjectPostponeSwipe>
                        </div>
                    </>
                ) : (
                    <div id="goals">Goals</div>
                )}
            </div>
            <GlobalModalsContainerRootView />
        </View>
    )
}
const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)
