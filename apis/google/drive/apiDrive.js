import { client_id } from '../apisConfig'
import scriptLoader from '../../scriptLoader'
import ProfileInit from '../profileInit'

const scriptSrcGoogle = 'https://accounts.google.com/gsi/client'

const config = {
    client_id,
    scope: 'https://www.googleapis.com/auth/drive.file',
}

class ApiDrive {
    tokenClient = null

    constructor(config) {
        this.config = config
        this.handleClientLoad()
    }

    handleClientLoad() {
        const self = this
        scriptLoader.loadScript(scriptSrcGoogle).then(() => {
            self.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: self.config.client_id,
                scope: self.config.scope,
            })
        })
    }

    requestConsent(callback) {
        //if (ProfileInit.checkAccessGranted()) {
        //    callback()
        // } else {
        this.tokenClient.callback = callback
        this.tokenClient.requestAccessToken({ prompt: 'consent' })
        // }
    }

    checkAccessGranted() {
        return ProfileInit.checkAccessGranted()
    }
}

let apiDrive
try {
    apiDrive = new ApiDrive(config)
} catch (e) {
    console.log(e)
}
export default apiDrive
