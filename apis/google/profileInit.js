import { apiKey, client_id } from './apisConfig'
import scriptLoader from '../scriptLoader'

const scriptSrcGapi = 'https://apis.google.com/js/api.js'

const discoveryDocs = [
    'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
    'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
    'https://docs.googleapis.com/$discovery/rest?version=v1',
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
]

const config = {
    apiKey,
    discoveryDocs,
}

class ProfileInit {
    constructor() {
        this.initializationPromise = null
    }

    async initGapiClient() {
        await window.gapi.client.init(config)
    }

    async handleClientLoad() {
        if (!window.gapi) await scriptLoader.loadScript(scriptSrcGapi)
        if (!window.gapi) throw new Error('Google API library failed to load properly')

        await new Promise((resolve, reject) => {
            try {
                window.gapi.load('client', resolve)
            } catch (error) {
                reject(error)
            }
        })
        await this.initGapiClient()
    }

    ensureInitialized() {
        if (!this.initializationPromise) {
            this.initializationPromise = this.handleClientLoad().catch(error => {
                this.initializationPromise = null
                console.error('Error loading Google API integrations:', error)
                throw error
            })
        }
        return this.initializationPromise
    }

    checkAccessGranted() {
        return !!window.gapi?.client?.getToken?.()
    }
}

let profileInit
try {
    profileInit = new ProfileInit(config)
} catch (e) {
    console.log(e)
}
export default profileInit
