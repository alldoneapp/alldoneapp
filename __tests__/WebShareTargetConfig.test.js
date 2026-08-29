const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const WEB_MANIFESTS = [
    'web-bundler/static/manifest.json',
    'web/manifest.json',
    'android-twa/app/src/main/res/raw/web_app_manifest.json',
]

const expectedParams = {
    title: 'share_title',
    text: 'share_text',
    url: 'share_url',
}

describe('Alldone Web Share Target configuration', () => {
    test.each(WEB_MANIFESTS)('%s routes shared text and links to All Projects', relativePath => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))

        expect(manifest.share_target).toEqual({
            action: '/projects/tasks/open',
            method: 'GET',
            enctype: 'application/x-www-form-urlencoded',
            params: expectedParams,
        })
    })

    test('keeps the Bubblewrap source manifest aligned with the PWA manifest', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'android-twa/twa-manifest.json'), 'utf8'))

        expect(manifest.shareTarget).toEqual({
            action: 'https://my.alldone.app/projects/tasks/open',
            method: 'GET',
            enctype: 'application/x-www-form-urlencoded',
            params: expectedParams,
        })
    })

    test('registers the generated Android TWA for text shares', () => {
        const androidManifest = fs.readFileSync(path.join(ROOT, 'android-twa/app/src/main/AndroidManifest.xml'), 'utf8')

        expect(androidManifest).toMatch(/android\.support\.customtabs\.trusted\.METADATA_SHARE_TARGET/)
        expect(androidManifest).toMatch(/android:name="android\.intent\.action\.SEND"/)
        expect(androidManifest).toMatch(/android:mimeType="text\/plain"/)
    })
})
