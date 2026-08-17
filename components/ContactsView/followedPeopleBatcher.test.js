import { createFollowedPeopleBatcher, getProjectsForFollowedPeopleWatch } from './followedPeopleBatcher'

describe('getProjectsForFollowedPeopleWatch', () => {
    const projects = [{ id: 'project-1' }, { id: 'project-2' }]

    it('does not open following listeners on the All tab', () => {
        expect(getProjectsForFollowedPeopleWatch(false, -1, projects)).toEqual([])
    })

    it('watches every project in All Projects on the Followed tab', () => {
        expect(getProjectsForFollowedPeopleWatch(true, -1, projects)).toBe(projects)
    })

    it('creates no listener for an inactive project removed from the view scope', () => {
        const activeProjects = [projects[0]]

        expect(getProjectsForFollowedPeopleWatch(true, -1, activeProjects)).toEqual([projects[0]])
    })

    it('watches only the selected project outside All Projects', () => {
        expect(getProjectsForFollowedPeopleWatch(true, 1, projects)).toEqual([projects[1]])
    })
})

describe('createFollowedPeopleBatcher', () => {
    it('coalesces a burst of project snapshots into one state update', () => {
        let scheduledCallback
        const schedule = jest.fn(callback => {
            scheduledCallback = callback
            return 42
        })
        const onFlush = jest.fn()
        const batcher = createFollowedPeopleBatcher(onFlush, schedule)

        batcher.add('project-1', { userIds: ['user-1'], contactIds: [] })
        batcher.add('project-2', { userIds: [], contactIds: ['contact-1'] })

        expect(schedule).toHaveBeenCalledTimes(1)
        expect(onFlush).not.toHaveBeenCalled()

        scheduledCallback()

        expect(onFlush).toHaveBeenCalledWith({
            'project-1': { userIds: ['user-1'], contactIds: [] },
            'project-2': { userIds: [], contactIds: ['contact-1'] },
        })
    })

    it('cancels a pending update when the view unmounts', () => {
        const cancelScheduled = jest.fn()
        const batcher = createFollowedPeopleBatcher(jest.fn(), () => 42, cancelScheduled)

        batcher.add('project-1', { userIds: [], contactIds: [] })
        batcher.cancel()

        expect(cancelScheduled).toHaveBeenCalledWith(42)
    })
})
