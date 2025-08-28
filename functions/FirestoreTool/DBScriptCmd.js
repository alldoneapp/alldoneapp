const admin = require('firebase-admin')
const { Command } = require('commander')
const chalk = require('chalk')
const { Spinner } = require('clui')
const AppInit = require('./AppInit')
const { PROJECT_ID_PROD, PROJECT_ID_DEV } = require('./Backups')
const { runCustomScript } = require('./DBScript')

const log = console.log

const spinner = new Spinner(chalk.blue.bold('Processing data and executing command...'), [
    '⣾',
    '⣽',
    '⣻',
    '⢿',
    '⡿',
    '⣟',
    '⣯',
    '⣷',
])

const dbscript = () => {
    const program = new Command('dbscript')
    program.alias('dbs').description('Run a custom Script to update some DB Data')

    program
        .command('run')
        .alias('r')
        .description('Run a custom Script to update some DB Data')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .action(args => runScriptCmd(args.project))

    return program
}

const runScriptCmd = projectId => {
    spinner.start()
    let appAdmin

    switch (projectId) {
        case PROJECT_ID_DEV:
            appAdmin = AppInit.init(admin, AppInit.APP_STAGING)
            break
        case PROJECT_ID_PROD:
            appAdmin = AppInit.init(admin, AppInit.APP_PRODUCTION)
            break
    }

    runCustomScript(appAdmin)
        .then(() => {
            log('\n\n')
            log(chalk.green(`Script run successfully!`))
            process.exit()
            spinner.stop()
        })
        .catch(error => {
            log('\n\n')
            log(chalk.red(`${chalk.bgRed.black.bold('Error:')} Run failed!`))
            log(chalk.red(`${error}`))
            process.exit()
            spinner.stop()
        })
}

module.exports = {
    dbscript,
}
