const admin = require('firebase-admin')
const { Command } = require('commander')
const chalk = require('chalk')
const { Spinner } = require('clui')
const { run } = require('./Utils/shell_runner')
const AppInit = require('./AppInit')
const { PROJECT_ID_PROD, PROJECT_ID_DEV } = require('./Backups')
const { gBackupDatabase, gRestoreDatabase, deleteCollections, getBackupsConfig } = require('./Backups')

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

const backups = () => {
    const program = new Command('backups')
    program.alias('bk').description('Manage Firestore backups')

    program
        .command('backup')
        .alias('b')
        .description('Export all collections of the Firestore project to the backup Storage bucket')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .action(args => {
            backupDatabase(args.project)
        })

    program
        .command('restore')
        .alias('r')
        .description('Import all collections from the backup Storage bucket to the Firestore project')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .option('-f, --from <from_project_id>', '[ Optional ] The Firebase Project ID from to import the Backup')
        .action(args => {
            restoreDatabase(args.project, args.from)
        })

    program
        .command('delete')
        .alias('d')
        .description('Delete all collections from database of the Firestore project')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .action(args => {
            deleteCollectionsCmd(args.project)
        })

    return program
}

const backupDatabase = projectId => {
    spinner.start()

    gBackupDatabase(projectId, '', '', stdout => {
        log('\n\n')
        log(chalk.green(`Command to export ${chalk.bgGreen.black.bold(` ${projectId} `)} database finished!`))
        process.exit()
        spinner.stop()
    })
}

const restoreDatabase = (projectId, fromProjectId) => {
    spinner.start()
    let config = {}

    if (fromProjectId && fromProjectId !== '') {
        config = getBackupsConfig(fromProjectId)
    } else {
        config = {
            bucketURL: '',
            projectId: '',
        }
    }

    gRestoreDatabase(projectId, config.bucketURL, config.projectId, stdout => {
        log('\n\n')
        log(chalk.green(`Command to import ${chalk.bgGreen.black.bold(` ${projectId} `)} database finished!`))
        process.exit()
        spinner.stop()
    })
}

const deleteCollectionsCmd = projectId => {
    spinner.start()
    deleteCollections(projectId, stdout => {
        log(chalk.green(`Command to delete ${chalk.bgGreen.black.bold(` ${projectId} `)} database finished!`))
        process.exit()
    })
}

module.exports = {
    backups,
}
