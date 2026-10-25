/** @jest-environment jsdom */

import { dayReloadCoordinator } from './dayReloadCoordinator'
import { setPendingTaskWriteCount } from './backends/pendingTaskWrites'

describe('dayReloadCoordinator', () => {
    afterEach(() => setPendingTaskWriteCount(0))

    it('holds the new-day reload while a task created in this page awaits its server ack', () => {
        const reload = jest.fn()
        setPendingTaskWriteCount(1)

        expect(dayReloadCoordinator.request(reload)).toBe(false)
        expect(reload).not.toHaveBeenCalled()

        // The ack is what releases it; nothing else has to call retry().
        setPendingTaskWriteCount(0)
        expect(reload).toHaveBeenCalledTimes(1)
    })
})
