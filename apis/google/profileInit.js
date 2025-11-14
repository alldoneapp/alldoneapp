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
        this.handleClientLoad()
    }

    async initGapiClient() {
        await gapi.client.init(config)
    }

    handleClientLoad() {
        const self = this
        scriptLoader
            .loadScript(scriptSrcGapi)
            .then(() => {
                if (window.gapi) {
                    gapi.load('client', () => self.initGapiClient())
                } else {
                    console.error('Google API library failed to load properly')
                }
            })
            .catch(error => {
                console.error('Error loading Google API script:', error)
                console.error('Google Calendar, Gmail, and Drive integrations will not be available')
            })
    }

    checkAccessGranted() {
        return !!gapi.client.getToken()
    }
}

let profileInit
try {
    profileInit = new ProfileInit(config)
} catch (e) {
    console.log(e)
}
export default profileInit
