import URLsNotes from '../../URLSystem/Notes/URLsNotes'
import URLsTasks from '../../URLSystem/Tasks/URLsTasks'
import URLsGoals from '../../URLSystem/Goals/URLsGoals'
import { setAnnaMode } from '../../utils/annaMode'

const listPath = '/projects/p1/user/u1/tasks/open'
const render = () => {
    const path = window.location.pathname
    if (path.includes('/notes/')) {
        const [, , projectId, , id, tab] = path.split('/')
        URLsNotes.push(
            tab === 'properties' ? 'NOTE_DETAILS_PROPERTIES' : 'NOTE_DETAILS_EDITOR',
            { note: id },
            projectId,
            id,
            id === 'n1' ? 'Workflow Feature' : 'Release plan'
        )
    } else if (path.includes('/goals/')) {
        URLsGoals.push('GOAL_DETAILS', { goal: 'g1' }, 'p1', 'g1')
    } else {
        URLsTasks.push('PROJECT_TASKS_OPEN', null, 'p1', 'u1')
    }
    document.querySelector('output').textContent = window.location.pathname
}

document.body.innerHTML = `
    <button id="note">Open Workflow Feature</button>
    <button id="properties">Note properties</button>
    <button id="next">Open Release plan</button>
    <button id="goal">Open goal</button>
    <button id="close">Close to tasks</button>
    <output></output>`

for (const [id, fn] of Object.entries({
    note: () => URLsNotes.push('NOTE_DETAILS_EDITOR', { note: 'n1' }, 'p1', 'n1', 'Workflow Feature'),
    properties: () => URLsNotes.push('NOTE_DETAILS_PROPERTIES', { note: 'n1' }, 'p1', 'n1', 'Workflow Feature'),
    next: () => URLsNotes.push('NOTE_DETAILS_EDITOR', { note: 'n2' }, 'p1', 'n2', 'Release plan'),
    goal: () => URLsGoals.push('GOAL_DETAILS', { goal: 'g1' }, 'p1', 'g1'),
    close: () => URLsTasks.push('PROJECT_TASKS_OPEN', null, 'p1', 'u1'),
})) {
    document.getElementById(id).onclick = () => {
        fn()
        render()
    }
}
window.onpopstate = render
window.__setAnnaMode = setAnnaMode
window.__listPath = listPath
render()
