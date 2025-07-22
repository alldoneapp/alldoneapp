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
    client_id,
    apiKey,
    discoveryDocs,
    scope: 'profile',
    cookiepolicy: 'single_host_origin',
    prompt: 'select_account',
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
        scriptLoader.loadScript(scriptSrcGapi).then(() => {
            gapi.load('client', () => self.initGapiClient())
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
