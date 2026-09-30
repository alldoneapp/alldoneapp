import { getMostVisibleTaskProjectId } from './visibleTaskProject'

const rect = (top, bottom, left = 0, right = 600) => ({ top, bottom, left, right })
let viewport

const addSection = (projectId, bounds, parent = viewport) => {
    const section = document.createElement('div')
    section.dataset.taskProjectId = projectId
    section.getBoundingClientRect = () => bounds
    parent.appendChild(section)
    return section
}

beforeEach(() => {
    viewport = document.createElement('div')
    viewport.id = 'main-task-list-viewport'
    viewport.getBoundingClientRect = () => rect(100, 600)
    document.body.appendChild(viewport)
})

afterEach(() => {
    document.body.replaceChildren()
    delete window.visualViewport
})

it('selects the larger visible part, even when another project is topmost and fully visible', () => {
    addSection('small-first', rect(100, 200))
    addSection('long-second', rect(220, 1500))
    expect(getMostVisibleTaskProjectId()).toBe('long-second')
})

it('works with only one project in All Projects and reads the current scroll position on every call', () => {
    const section = addSection('only-project', rect(200, 900))
    expect(getMostVisibleTaskProjectId()).toBe('only-project')
    section.getBoundingClientRect = () => rect(-900, 90)
    expect(getMostVisibleTaskProjectId()).toBeNull()
    addSection('next-project', rect(200, 900))
    expect(getMostVisibleTaskProjectId()).toBe('next-project')
})

it('clips against the list viewport rather than counting offscreen content', () => {
    addSection('above', rect(-200, 110))
    addSection('inside', rect(150, 450))
    addSection('below', rect(590, 1500))
    expect(getMostVisibleTaskProjectId()).toBe('inside')
})

it('keeps no context for an empty list or a viewport showing only the global header', () => {
    expect(getMostVisibleTaskProjectId()).toBeNull()
    addSection('below-header', rect(650, 1000))
    expect(getMostVisibleTaskProjectId()).toBeNull()
})

it('keeps no context when different projects have equal visibility', () => {
    addSection('first', rect(100, 300))
    addSection('second', rect(400, 600))
    expect(getMostVisibleTaskProjectId()).toBeNull()
})

it('ignores project sections outside the task list and sections hidden during exit', () => {
    addSection('other-view', rect(100, 600), document.body)
    addSection('hidden', rect(100, 600)).style.opacity = '0'
    addSection('visible', rect(400, 600))
    expect(getMostVisibleTaskProjectId()).toBe('visible')
})

it('clips to the visual viewport when the mobile keyboard covers the bottom of the list', () => {
    window.visualViewport = { offsetTop: 0, offsetLeft: 0, height: 350, width: 600 }
    addSection('upper', rect(100, 300))
    addSection('lower', rect(320, 600))
    expect(getMostVisibleTaskProjectId()).toBe('upper')
})

it('measures horizontally visible area too', () => {
    addSection('mostly-outside', rect(100, 600, 590, 1000))
    addSection('inside', rect(400, 600))
    expect(getMostVisibleTaskProjectId()).toBe('inside')
})

it('returns no context when the task list is absent or has no visible size', () => {
    viewport.remove()
    expect(getMostVisibleTaskProjectId()).toBeNull()
    document.body.appendChild(viewport)
    viewport.getBoundingClientRect = () => rect(100, 100)
    expect(getMostVisibleTaskProjectId()).toBeNull()
})
