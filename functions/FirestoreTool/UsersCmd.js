const admin = require('firebase-admin')
const { Command } = require('commander')
const chalk = require('chalk')
const { Spinner } = require('clui')
const { run } = require('./Utils/shell_runner')
const AppInit = require('./AppInit')
const { PROJECT_ID_PROD, PROJECT_ID_DEV } = require('./Backups')
const {
    IMPORT_OPTION_FILE,
    exportUsers,
    exportDBUsers,
    importUsers,
    removeUsersFromBackup,
    checkUsersIntegrity,
} = require('./Users')

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

const users = () => {
    const program = new Command('users')
    program.alias('us').description('Manage users of Firebase Auth')

    program
        .command('export')
        .alias('e')
        .description('Export the list of users from Auth of the Firestore project')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .option('-t, --type <type>', '[ Optional ] Type of action to apply when export users ( LIST | SAVE )')
        .option('-f, --file <file>', '[ Optional ] If type of action is "SAVE" then pass here the path to the file')
        .action(args => {
            exportUsersCmd(args.project, args.type, args.file)
        })

    program
        .command('exportdb')
        .alias('edb')
        .description('Export the list of users from the user collection of the DB')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .option('-t, --type <type>', '[ Optional ] Type of action to apply when export users ( LIST | SAVE )')
        .option('-f, --file <file>', '[ Optional ] If type of action is "SAVE" then pass here the path to the file')
        .action(args => {
            exportDBUsersCmd(args.project, args.type, args.file)
        })

    program
        .command('import')
        .alias('i')
        .description('Import the list of users to Auth of the Firestore project')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .requiredOption('-f, --file <file>', '[ Required ] The path to the file with user list in JSON format')
        .action(args => {
            importUsersCmd(args.project, args.file)
        })

    program
        .command('remove')
        .alias('r')
        .description('Remove a list of users from Auth of the Firestore project, from a previous backup file.')
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .requiredOption('-f, --file <file>', '[ Required ] The path to the file with user list in JSON format')
        .action(args => {
            removeUsersCmd(args.project, args.file)
        })

    program
        .command('check-integrity')
        .alias('cint')
        .description(
            'Check integrity by comparing users that exists in the Firebase Auth section against the Users DB Collection'
        )
        .requiredOption('-p, --project <project_id>', '[ Required ] The Firebase Project ID')
        .option('-t, --type <type>', '[ Optional ] Type of action to apply when export users ( LIST | SAVE )')
        .option('-f, --file <file>', '[ Optional ] If type of action is "SAVE" then pass here the path to the file')
        .option('-r, --remove', '[ Optional ] Remove the orphans users (DATA WILL NOT BE RECOVERABLE)')
        .action(args => {
            checkUsersIntegrityCmd(args.project, args.type, args.file, args.remove)
        })

    return program
}

const exportUsersCmd = (projectId, type, file) => {
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

    exportUsers(appAdmin, type, file)
        .then(users => {
            log('\n\n')
            log(chalk.green(`Users from ${chalk.bgGreen.black.bold(` ${projectId} `)} exported successfully!`))
            log(chalk.green(`Exported ${users.length} users`))
            if (file && file !== '' && file !== '.' && file !== '..') {
                log(chalk.green('Remember check the file to be sure the users were exported successfully.'))
            }
            process.exit()
            spinner.stop()
        })
        .catch(error => {
            log('\n\n')
            log(chalk.red(`${chalk.bgRed.black.bold('Error:')} Export failed!`))
            log(chalk.red(`${error}`))
            process.exit()
            spinner.stop()
        })
}

const exportDBUsersCmd = (projectId, type, file) => {
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

    exportDBUsers(appAdmin, type, file)
        .then(users => {
            log('\n\n')
            log(chalk.green(`Users from ${chalk.bgGreen.black.bold(` ${projectId} `)} exported successfully!`))
            log(chalk.green(`Exported ${users.length} users`))
            if (file && file !== '' && file !== '.' && file !== '..') {
                log(chalk.green('Remember check the file to be sure the users were exported successfully.'))
            }
            process.exit()
            spinner.stop()
        })
        .catch(error => {
            log('\n\n')
            log(chalk.red(`${chalk.bgRed.black.bold('Error:')} Export failed!`))
            log(chalk.red(`${error}`))
            process.exit()
            spinner.stop()
        })
}

const importUsersCmd = (projectId, file) => {
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

    importUsers(appAdmin, file, IMPORT_OPTION_FILE)
        .then(users => {
            log('\n\n')
            log(chalk.green(`Users from ${chalk.bgGreen.black.bold(` ${projectId} `)} imported successfully!`))
            log(chalk.green(`Imported ${users.length} users`))
            if (file && file !== '' && file !== '.' && file !== '..') {
                log(
                    chalk.green(
                        'Remember check the Firebase Auth section to be sure the users were imported successfully.'
                    )
                )
            }
            process.exit()
            spinner.stop()
        })
        .catch(error => {
            log('\n\n')
            log(chalk.red(`${chalk.bgRed.black.bold('Error:')} Import failed!`))
            log(chalk.red(`${error}`))
            process.exit()
            spinner.stop()
        })
}

const removeUsersCmd = (projectId, file) => {
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

    removeUsersFromBackup(appAdmin, file)
        .then(users => {
            log('\n\n')
            log(chalk.green(`Users from ${chalk.bgGreen.black.bold(` ${projectId} `)} removed successfully!`))
            log(chalk.green(`Removed ${users.length} users`))
            if (file && file !== '' && file !== '.' && file !== '..') {
                log(
                    chalk.green(
                        'Remember check the Firebase Auth section to be sure the users were removed successfully.'
                    )
                )
            }
            process.exit()
            spinner.stop()
        })
        .catch(error => {
            log('\n\n')
            log(chalk.red(`${chalk.bgRed.black.bold('Error:')} Remove failed!`))
            log(chalk.red(`${error}`))
            process.exit()
            spinner.stop()
        })
}

const checkUsersIntegrityCmd = (projectId, type, file, remove) => {
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

    if (remove) {
        log(chalk.bgYellow.black.bold('WILL REMOVE ORPHAN USERS'))
    }

    checkUsersIntegrity(appAdmin, type, file, remove)
        .then(users => {
            log('\n\n')
            log(chalk.green(`Users from ${chalk.bgGreen.black.bold(` ${projectId} `)} checked successfully!`))
            if (remove) {
                log(chalk.bgYellowBright.black.bold(`Removed ${users.length} orphan users from Firebase Auth`))
            }
            log(chalk.green(`Exported ${users.length} users`))
            if (file && file !== '' && file !== '.' && file !== '..') {
                log(chalk.green('Remember check the file to be sure the users that were cleaned.'))
            }
            process.exit()
            spinner.stop()
        })
        .catch(error => {
            log('\n\n')
            log(chalk.red(`${chalk.bgRed.black.bold('Error:')} Export failed!`))
            log(chalk.red(`${error}`))
            process.exit()
            spinner.stop()
        })
}

module.exports = {
    users,
}
