// react-native-dotenv resolves every `react-native-dotenv` import while Babel
// is still transforming the file, and throws when a name is missing from .env.
// The web builds get the real values substituted into the BEGIN-ENVS block by
// the sed in .gitlab-ci.yml, but the Jest job has no such step and .env is not
// in the repository, so any suite that reaches utils/backends/firestore.js
// fails to parse.
//
// The unit tests never talk to Firebase, Algolia or Sentry, so the values are
// irrelevant - only the names have to exist. Derive them from the source rather
// than keeping a second list in sync by hand, and leave an existing .env alone
// so this is a no-op for anyone running the tests locally.

const { execFileSync } = require('child_process')
const { existsSync, writeFileSync } = require('fs')

const envPath = '.env'

if (existsSync(envPath)) {
    process.stdout.write(`${envPath} already exists, leaving it untouched\n`)
    process.exit(0)
}

const excludedRoots = ['.claude/', 'functions/', 'node_modules/', 'replacement_node_modules/']

const trackedFiles = execFileSync('git', ['ls-files', '-z', '*.js', '*.jsx', '*.ts', '*.tsx'], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
})
    .split('\0')
    .filter(Boolean)
    .filter(file => !excludedRoots.some(root => file.startsWith(root)))

const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]react-native-dotenv['"]/g
const names = new Set()

for (const file of trackedFiles) {
    const source = require('fs').readFileSync(file, 'utf8')
    if (!source.includes('react-native-dotenv')) continue

    let match
    while ((match = importPattern.exec(source)) !== null) {
        match[1]
            .split(',')
            .map(specifier =>
                specifier
                    .trim()
                    .split(/\s+as\s+/)[0]
                    .trim()
            )
            .filter(Boolean)
            .forEach(name => names.add(name))
    }
}

if (names.size === 0) {
    process.stderr.write('No react-native-dotenv imports found; refusing to write an empty .env\n')
    process.exit(1)
}

const contents = [...names]
    .sort()
    .map(name => `${name}=`)
    .join('\n')
writeFileSync(envPath, `${contents}\n`)

process.stdout.write(`Wrote ${envPath} with ${names.size} placeholder variables for the test run\n`)
