// Node 22 + Playwright/Chromium. Optional PULSE_SERVER and PAREC record the OS
// output sink (not a WebAudio node, mock, or generated WAV inspection).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const { execFileSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const baseline = process.argv.includes('--baseline')
const output = path.join(__dirname, baseline ? '.build-baseline' : '.build')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
    if (!process.argv.includes('--skip-build'))
        execFileSync(
            path.join(root, 'web-bundler/node_modules/.bin/webpack'),
            [
                '--config',
                path.join(root, 'browser-tests/webpack.harness.js'),
                '--mode',
                'development',
                '--env',
                `harnessEntry=${path.join(__dirname, 'harness.entry.js')}`,
                '--env',
                `harnessSetup=${path.join(__dirname, 'setup.js')}`,
                '--env',
                `harnessOut=${output}`,
            ],
            { cwd: root, stdio: 'inherit', env: { ...process.env, AT2778_BASELINE: baseline ? '1' : '' } }
        )
    const server = http.createServer((req, res) => {
        if (req.url.split('?')[0].endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript')
            res.end(fs.readFileSync(path.join(output, path.basename(req.url.split('?')[0]))))
        } else {
            res.setHeader('Content-Type', 'text/html')
            res.end(
                '<!doctype html><meta charset="utf-8"><div id="root"></div><script defer src="/harness.js"></script>'
            )
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser, recorder
    const results = []
    let chunks = []
    try {
        if (process.env.PAREC) {
            recorder = spawn(process.env.PAREC, [
                '--device=ringback.monitor',
                '--raw',
                '--format=float32le',
                '--rate=48000',
                '--channels=1',
                '--latency-msec=30',
            ])
            recorder.stdout.on('data', data => chunks.push(data))
            recorder.stderr.on('data', data => process.stderr.write(data))
            recorder.on('error', error => {
                throw error
            })
        }
        const browserRequire = createRequire(path.join(process.env.PLAYWRIGHT_HOME || root, 'package.json'))
        browser = await browserRequire('playwright').chromium.launch({
            executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
            ignoreDefaultArgs: ['--mute-audio'],
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--autoplay-policy=document-user-activation-required',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
            ],
        })
        let page = await browser.newPage()
        page.setDefaultTimeout(15000)
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const open = async () => {
            await page.goto(`http://127.0.0.1:${server.address().port}/`)
            await page.getByRole('button', { name: 'Talk with Anna', exact: true }).waitFor()
        }
        const measure = async (label, ms, expected) => {
            chunks = []
            await delay(ms)
            if (!recorder) return
            const bytes = Buffer.concat(chunks)
            let energy = 0,
                peak = 0,
                crossings = 0,
                previous = 0
            for (let i = 0; i + 4 <= bytes.length; i += 4) {
                const v = bytes.readFloatLE(i)
                energy += v * v
                peak = Math.max(peak, Math.abs(v))
                if (v > 0 && previous <= 0) crossings++
                previous = v
            }
            const samples = bytes.length / 4,
                rms = Math.sqrt(energy / samples)
            const row = {
                label,
                samples,
                rms: +rms.toFixed(5),
                peak: +peak.toFixed(5),
                frequencyHz: Math.round(crossings / (samples / 48000)),
            }
            results.push(row)
            console.log(JSON.stringify(row))
            assert.ok(samples > 4800, `${label}: real OS output samples required`)
            assert.equal(rms > 0.005, expected, JSON.stringify(row))
        }
        await open()
        await page.getByRole('button', { name: 'Talk with Anna', exact: true }).click()
        await delay(100)
        await measure('thread lookup: first ring', 650, !baseline)
        if (baseline) {
            assert.equal(await page.evaluate(() => document.querySelectorAll('audio').length), 0)
            assert.equal(await page.evaluate(() => window.call.status), 'idle')
            await page.getByRole('button', { name: 'Cancel call', exact: true }).click()
            console.log(
                'BASELINE reproduced: Assistant Mode shows connecting but creates no player, tone or wake lease during thread lookup.'
            )
        } else {
            assert.equal(await page.evaluate(() => window.call.status), 'connecting')
            await delay(1000)
            await measure('ring gap', 700, false)
            await delay(2600)
            await measure('thread lookup: repeated ring', 650, true)
            await page.evaluate(() => window.resolveThread())
            await page.waitForFunction(() => !!window.handback)
            assert.equal(await page.evaluate(() => document.querySelector('audio').loop), true)
            await page.evaluate(() => window.handback())
            await page.waitForFunction(() => !!window.answer)
            await page.evaluate(() => window.answer())
            await page.waitForFunction(() => !!window.ready)
            assert.equal(
                await page.evaluate(() => document.querySelector('audio').loop),
                true,
                'remote track must not prematurely stop ringback'
            )
            await page.evaluate(() => window.ready())
            await page.waitForFunction(() => window.call.status === 'connected')
            assert.equal(await page.evaluate(() => document.querySelector('audio').loop), false)
            await delay(300)
            await measure('conversation ready: no ringback', 600, false)
            const greeting = await page.evaluate(() =>
                window.timeline.find(e => e.event === 'session.commentary.append')
            )
            assert.ok(greeting, 'greeting only after remote playback')
            assert.equal(greeting.ringLoop, false, 'stop ringback before greeting')
            await page.evaluate(() => window.call.cleanup())
            await page.evaluate(() => window.remoteContext?.close())

            for (const mode of ['cancel', 'lookup-error', 'server-error']) {
                await open()
                await page.getByRole('button', { name: 'Talk with Anna', exact: true }).click()
                await delay(100)
                await measure(`${mode}: audible startup`, 500, true)
                if (mode === 'cancel') {
                    await page.getByRole('button', { name: 'Cancel call', exact: true }).click()
                    await page.evaluate(() => window.resolveThread())
                } else if (mode === 'lookup-error') await page.evaluate(() => window.rejectThread())
                else {
                    await page.evaluate(() => window.resolveThread())
                    await page.waitForFunction(() => !!window.handback)
                    await page.evaluate(() => window.handback())
                    await page.waitForFunction(() => !!window.fail)
                    await page.evaluate(() => window.fail(new Error('Network failed')))
                }
                await page.waitForFunction(() => window.call.status === 'idle')
                await delay(300)
                await measure(`${mode}: cleanup silence`, 500, false)
                assert.equal(await page.evaluate(() => document.querySelectorAll('audio').length), 0)
                await page.getByRole('button', { name: 'Talk with Anna', exact: true }).click()
                await delay(100)
                await measure(`${mode}: immediate retry`, 500, true)
                await page.getByRole('button', { name: 'Cancel call', exact: true }).click()
            }
            // Exercise the real browser's denial with NO click and NO capture
            // active, then recover using the UI's actual user gesture.
            await page.close()
            page = await browser.newPage()
            page.setDefaultTimeout(15000)
            page.on('pageerror', error => errors.push(error.message))
            await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=autoplay`)
            await page.waitForFunction(() => window.call.needsAudioPlayback)
            await measure('native autoplay denial: silence', 400, false)
            await page.getByRole('button', { name: 'Enable call audio', exact: true }).click()
            await page.waitForFunction(() => !window.call.needsAudioPlayback)
            await delay(100)
            await measure('native autoplay denial: recovered by gesture', 500, true)
            await page.getByRole('button', { name: 'Cancel call', exact: true }).click()
        }
        assert.deepEqual(errors, [])
        fs.writeFileSync(
            path.join(output, 'audio-measurements.json'),
            JSON.stringify({ browser: browser.version(), baseline, osSinkCaptured: !!recorder, results }, null, 2)
        )
        console.log(
            JSON.stringify({ browser: browser.version(), baseline, osSinkCaptured: !!recorder, results }, null, 2)
        )
        if (!recorder) console.log('LIMIT: no OS output recording; set PAREC and PULSE_SERVER for PCM assertions.')
    } finally {
        recorder?.kill()
        await browser?.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
