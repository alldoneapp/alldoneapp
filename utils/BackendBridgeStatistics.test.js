jest.mock('./backends/firestore', () => ({ getUserStatistics: jest.fn() }))
jest.mock('./backends/Goals/goalsFirestore', () => ({}))
jest.mock('./backends/Projects/projectsFirestore', () => ({}))
jest.mock('./backends/Skills/skillsFirestore', () => ({}))

import Backend from './BackendBridge'
import { getUserStatistics } from './backends/firestore'

it('passes the popup direct-read option through the backend adapter and returns the read', () => {
    const callback = jest.fn()
    const onError = jest.fn()
    const read = Promise.resolve()
    getUserStatistics.mockReturnValue(read)
    expect(Backend.getUserStatistics('p1', 'u1', '06092026', callback, onError, { preferDirect: true })).toBe(read)
    expect(getUserStatistics).toHaveBeenCalledWith('p1', 'u1', '06092026', callback, onError, { preferDirect: true })
})
