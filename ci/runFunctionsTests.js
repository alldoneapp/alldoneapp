const { run } = require('./runWebTests')
try {
    process.exitCode = run({
        kind: 'functions',
        planFile: 'functions-test-scope.json',
        checkScope: process.argv.includes('--check-scope'),
        branchBase: process.argv.includes('--branch') ? process.argv[process.argv.indexOf('--branch') + 1] : undefined,
    })
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
}
