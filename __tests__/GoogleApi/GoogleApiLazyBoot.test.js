const mockLoadScript = jest.fn(() => Promise.resolve())

jest.mock('../../apis/scriptLoader', () => ({
    __esModule: true,
    default: {
        loadScript: (...args) => mockLoadScript(...args),
    },
}))

jest.mock('../../utils/Observers', () => ({
    deleteCacheAndRefresh: jest.fn(),
}))

describe('Google API lazy initialization', () => {
    beforeEach(() => {
        jest.resetModules()
        jest.useFakeTimers()
        mockLoadScript.mockReset()
        mockLoadScript.mockResolvedValue(undefined)
        delete window.gapi
        delete window.google
    })

    afterEach(() => {
        jest.useRealTimers()
        delete window.gapi
        delete window.google
    })

    it('does not load Google scripts just because app modules were imported', () => {
        jest.isolateModules(() => {
            require('../../apis/google/GoogleApi')
            require('../../apis/google/profileInit')
            require('../../apis/google/calendar/apiCalendar')
            require('../../apis/google/gmail/apiGmail')
            require('../../apis/google/drive/apiDrive')
        })

        jest.runOnlyPendingTimers()

        expect(mockLoadScript).not.toHaveBeenCalled()
    })

    it('loads and initializes the shared Google client on first demand', async () => {
        const init = jest.fn(() => Promise.resolve())
        mockLoadScript.mockImplementation(url => {
            if (url === 'https://apis.google.com/js/api.js') {
                window.gapi = {
                    load: (name, callback) => callback(),
                    client: { init },
                }
            }
            return Promise.resolve()
        })
        let profileInit
        jest.isolateModules(() => {
            profileInit = require('../../apis/google/profileInit').default
        })

        await profileInit.ensureInitialized()
        await profileInit.ensureInitialized()

        expect(mockLoadScript).toHaveBeenCalledTimes(1)
        expect(init).toHaveBeenCalledTimes(1)
    })

    it('loads the combined Calendar and Gmail client only once on first demand', async () => {
        const init = jest.fn(() => Promise.resolve())
        const initTokenClient = jest.fn(() => ({ requestAccessToken: jest.fn() }))
        mockLoadScript.mockImplementation(url => {
            if (url === 'https://apis.google.com/js/api.js') {
                window.gapi = {
                    load: (name, callback) => callback(),
                    client: { init },
                }
            }
            if (url === 'https://accounts.google.com/gsi/client') {
                window.google = { accounts: { oauth2: { initTokenClient } } }
            }
            return Promise.resolve()
        })
        let googleApi
        jest.isolateModules(() => {
            googleApi = require('../../apis/google/GoogleApi').default
        })

        await googleApi.ensureInitialized()
        await googleApi.ensureInitialized()

        expect(mockLoadScript).toHaveBeenCalledTimes(2)
        expect(init).toHaveBeenCalledTimes(1)
        expect(initTokenClient).toHaveBeenCalledTimes(2)
    })
})
