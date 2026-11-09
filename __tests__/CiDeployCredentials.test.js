/** @jest-environment node */
// Deploy credentials are split by environment (security audit 2026-11, NV-08 and NV-32).
//
// Every Firebase deploy used to share one `firebase login:ci` token that could reach both
// projects and that develop and every feature-branch pipeline could read, and the staging
// functions job wrote the production service-account key into functions/, from where it
// was zipped into the uploaded function source. These tests hold the new shape: one
// production credential only default-branch jobs use, one staging credential for the rest,
// no key in the functions source, and no fallback to the old token.
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const yaml = require('js-yaml')

const REPO_ROOT = path.join(__dirname, '..')
const HELPER = path.join(REPO_ROOT, 'ci', 'useFirebaseDeployCredentials.sh')
const CI_SOURCE = fs.readFileSync(path.join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8')
const CI_CONFIG = yaml.load(CI_SOURCE)

const jobs = () =>
    Object.entries(CI_CONFIG).filter(
        ([name, job]) => job && typeof job === 'object' && !name.startsWith('.') && Array.isArray(job.script)
    )
const lines = job => [].concat(job.before_script || [], job.script || [])
const text = job => lines(job).join('\n')

// Anything that talks to a Firebase project with whatever credential the job holds.
const FIREBASE_COMMAND =
    /\bfirebase (deploy|use|hosting:|functions:list|firestore:)|runFunctionsDeployment\.js|check-firestore-indexes\.js/
const onlyOnDefaultBranch = job =>
    Array.isArray(job.rules) &&
    job.rules.length > 0 &&
    job.rules.every(rule => String(rule.if || '').trim() === '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH')

describe('Firebase deploy credentials per environment', () => {
    const firebaseJobs = jobs().filter(([, job]) => lines(job).some(line => FIREBASE_COMMAND.test(line)))

    it('finds the jobs it is about', () => {
        expect(firebaseJobs.map(([name]) => name).sort()).toEqual(
            [
                'check:firestore:indexes:production',
                'check:firestore:indexes:staging',
                'deploy:cloud:functions:production',
                'deploy:cloud:functions:staging',
                'deploy:firestore:rules:production',
                'deploy:web',
                'deploy:web-dev',
                'deploy:web-staging-live',
                'deploy:web-webpack-preview',
            ].sort()
        )
    })

    it.each(firebaseJobs)('%s selects the credential matching where it can run', (name, job) => {
        const environment = onlyOnDefaultBranch(job) ? 'production' : 'staging'
        const source = lines(job)
        const helperIndex = source.findIndex(line => line.includes(`useFirebaseDeployCredentials.sh ${environment}`))
        const firstFirebase = source.findIndex(line => FIREBASE_COMMAND.test(line))
        expect(`${name}:${helperIndex}`).not.toBe(`${name}:-1`)
        expect(`${name}:${helperIndex < firstFirebase}`).toBe(`${name}:true`)
        // ...and never the other one.
        const other = environment === 'production' ? 'staging' : 'production'
        expect(text(job)).not.toContain(`useFirebaseDeployCredentials.sh ${other}`)
    })

    it('never authenticates with the shared login token again', () => {
        expect(CI_SOURCE).not.toContain('GOOGLE_FIREBASE_DEPLOY_TOKEN')
        expect(CI_SOURCE).not.toMatch(/--token\b/)
        for (const file of fs.readdirSync(path.join(REPO_ROOT, 'ci'))) {
            if (!/\.(js|sh)$/.test(file) || file === 'useFirebaseDeployCredentials.sh') continue
            expect(
                `${file}: ${fs.readFileSync(path.join(REPO_ROOT, 'ci', file), 'utf8').includes('GOOGLE_FIREBASE_DEPLOY_TOKEN')}`
            ).toBe(`${file}: false`)
        }
    })

    it('names the credential variables only inside the helper', () => {
        // A job cannot pick the production credential by name; it has to go through the
        // helper's default-branch check (and the variable is protected besides).
        expect(CI_SOURCE).not.toContain('FIREBASE_DEPLOY_SA_PROD')
        expect(CI_SOURCE).not.toContain('FIREBASE_DEPLOY_SA_STAGING')
    })

    it('keeps the runtime service-account keys out of every job but the production runner deploy', () => {
        for (const [name, job] of jobs()) {
            if (name !== 'deploy:cloud:runner:production') {
                expect(`${name}: ${text(job).includes('GOOGLE_SERVICE_ACCOUNT_MASTER')}`).toBe(`${name}: false`)
            }
            // Whatever lands in functions/service_accounts is a candidate for the upload.
            expect(`${name}: ${/service_accounts\/\S*\.json/.test(text(job))}`).toBe(`${name}: false`)
        }
        expect(onlyOnDefaultBranch(CI_CONFIG['deploy:cloud:runner:production'])).toBe(true)
    })

    it('records the production functions and runner deploys against the production environment', () => {
        for (const name of [
            'deploy:web',
            'deploy:cloud:functions:production',
            'deploy:cloud:runner:production',
            'deploy:firestore:rules:production',
        ]) {
            expect(`${name}: ${(CI_CONFIG[name].environment || {}).name}`).toBe(`${name}: production`)
        }
    })
})

describe('ci/useFirebaseDeployCredentials.sh', () => {
    const keyFor = project => ({
        type: 'service_account',
        project_id: project,
        client_email: `firebase-deploy@${project}.iam.gserviceaccount.com`,
        private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
    })

    const source = (environment, env) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-creds-'))
        try {
            const script = `. "${HELPER}" ${environment}\nprintf 'GAC=%s\\nPROJECT=%s\\nTOKEN=%s\\n' "$GOOGLE_APPLICATION_CREDENTIALS" "$FIREBASE_DEPLOY_PROJECT" "\${GOOGLE_FIREBASE_DEPLOY_TOKEN:-}\${FIREBASE_TOKEN:-}"\n[ -f "$GOOGLE_APPLICATION_CREDENTIALS" ] && echo KEYFILE=present\n`
            const result = spawnSync('sh', ['-c', script], {
                encoding: 'utf8',
                env: { PATH: process.env.PATH, TMPDIR: dir, ...env },
            })
            return { status: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }
    const master = { CI_DEFAULT_BRANCH: 'master', CI_COMMIT_BRANCH: 'master', CI_COMMIT_REF_PROTECTED: 'true' }

    it('hands firebase-tools the production account on a protected default-branch pipeline', () => {
        const result = source('production', {
            ...master,
            FIREBASE_DEPLOY_SA_PROD: JSON.stringify(keyFor('alldonealeph')),
            GOOGLE_FIREBASE_DEPLOY_TOKEN: 'old-shared-token',
            FIREBASE_TOKEN: 'old-env-token',
        })
        expect(result.status).toBe(0)
        expect(result.out).toContain('PROJECT=alldonealeph')
        expect(result.out).toContain('KEYFILE=present')
        // firebase-tools prefers a token over ADC, so the old ones must be gone.
        expect(result.out).toContain('TOKEN=\n')
        expect(result.all).not.toContain('not-a-real-key')
    })

    it('accepts a GitLab File variable (the value is a path)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-creds-file-'))
        const file = path.join(dir, 'key.json')
        fs.writeFileSync(file, JSON.stringify(keyFor('alldonestaging')))
        try {
            const result = source('staging', { CI_COMMIT_BRANCH: 'feature', FIREBASE_DEPLOY_SA_STAGING: file })
            expect(result.status).toBe(0)
            expect(result.out).toContain(`GAC=${file}`)
            expect(result.out).toContain('PROJECT=alldonestaging')
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it.each([
        [
            'a feature branch',
            { CI_DEFAULT_BRANCH: 'master', CI_COMMIT_BRANCH: 'feature', CI_COMMIT_REF_PROTECTED: 'false' },
        ],
        [
            'an unprotected default branch',
            { CI_DEFAULT_BRANCH: 'master', CI_COMMIT_BRANCH: 'master', CI_COMMIT_REF_PROTECTED: 'false' },
        ],
    ])('refuses the production credential on %s', (_label, env) => {
        const result = source('production', { ...env, FIREBASE_DEPLOY_SA_PROD: JSON.stringify(keyFor('alldonealeph')) })
        expect(result.status).toBe(1)
        expect(result.all).toContain('only for protected default-branch pipelines')
    })

    it('fails loudly, naming the variable, instead of falling back to the old token', () => {
        const result = source('production', { ...master, GOOGLE_FIREBASE_DEPLOY_TOKEN: 'old-shared-token' })
        expect(result.status).toBe(1)
        expect(result.all).toContain('FIREBASE_DEPLOY_SA_PROD is not set')
    })

    it('refuses a staging credential that belongs to the production project', () => {
        const result = source('staging', {
            CI_COMMIT_BRANCH: 'feature',
            FIREBASE_DEPLOY_SA_STAGING: JSON.stringify(keyFor('alldonealeph')),
        })
        expect(result.status).toBe(1)
        expect(result.all).toContain('not to a service account of alldonestaging')
    })

    it('refuses something that is not a service account key, without echoing it', () => {
        const result = source('staging', {
            CI_COMMIT_BRANCH: 'feature',
            FIREBASE_DEPLOY_SA_STAGING: 'secret-but-not-json',
        })
        expect(result.status).toBe(1)
        expect(result.all).toContain('not valid JSON')
        expect(result.all).not.toContain('secret-but-not-json')
    })
})

describe('the Functions source upload carries no service-account key (NV-08)', () => {
    const { readdirRecursive } = require('firebase-tools/lib/fsAsync')
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'firebase.json'), 'utf8')).functions

    it('excludes key files and CI scratch files the way firebase-tools 13 packages the source', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'functions-upload-'))
        const files = [
            'index.js',
            'env_functions.json',
            'ci-deployment.json',
            'Assistant/helper.js',
            'service_accounts/serviceAccountKey.json',
            'service_accounts/serv_account_key_master.json',
            'service_accounts/serv_account_key_develop.json',
            'service_accounts/alldonealeph-firebase-adminsdk-mpg7p-0123456789.json',
            'service_accounts/setup_functions.sh',
            'serv_account_key_master.json',
            'tmp_project_name',
        ]
        try {
            for (const file of files) {
                fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
                fs.writeFileSync(path.join(dir, file), 'x')
            }
            // prepareFunctionsUpload.js adds these to firebase.json's list.
            const ignore = [...config.ignore, 'firebase-debug.log', 'firebase-debug.*.log', '.runtimeconfig.json']
            const packaged = (await readdirRecursive({ path: dir, ignore }))
                .map(entry => path.relative(dir, entry.name))
                .sort()
            // The runtime reads env_functions.json and the deploy stamp; both must still ship.
            expect(packaged).toEqual(['Assistant/helper.js', 'ci-deployment.json', 'env_functions.json', 'index.js'])
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
})
