import NavigationService from '../utils/NavigationService'

describe('NavigationService route store', () => {
    it('notifies subscribers and remounts via a fresh id on every navigate', () => {
        const listener = jest.fn()
        const unsubscribe = NavigationService.subscribe(listener)
        const before = NavigationService.getCurrentState()

        NavigationService.navigate('SettingsView', { section: 'profile' })

        expect(listener).toHaveBeenCalledTimes(1)
        const state = NavigationService.getCurrentState()
        expect(state.routeName).toBe('SettingsView')
        expect(state.params).toEqual({ section: 'profile' })
        expect(state.id).toBe(before.id + 1)

        unsubscribe()
        NavigationService.navigate('Root')
        expect(listener).toHaveBeenCalledTimes(1)
    })

    it('exposes the react-navigation prop surface the screens rely on', () => {
        NavigationService.navigate('TaskDetailedView', { taskId: 'task-1' })
        const navigation = NavigationService.createNavigationProp()

        expect(navigation.getParam('taskId')).toBe('task-1')
        expect(navigation.getParam('missing', 'fallback')).toBe('fallback')
        expect(navigation.state.params).toEqual({ taskId: 'task-1' })
        expect(typeof navigation.navigate).toBe('function')

        // Params are captured per screen instance: navigating away must not
        // change what an already-created prop reports.
        NavigationService.navigate('Root')
        expect(navigation.getParam('taskId')).toBe('task-1')
    })

    it('keeps setTopLevelNavigator as a harmless legacy no-op', () => {
        expect(() => NavigationService.setTopLevelNavigator({ dispatch: () => {} })).not.toThrow()
    })
})
