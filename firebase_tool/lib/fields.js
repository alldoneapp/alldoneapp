const { Command } = require('commander')
const chalk = require('chalk/index')
const { run } = require('./shell_runner')
const { Spinner } = require('clui')

const log = console.log

const MANAGE_FIELD_INSERT = 'MANAGE_FIELD_INSERT'
const MANAGE_FIELD_UPDATE = 'MANAGE_FIELD_UPDATE'
const MANAGE_FIELD_DELETE = 'MANAGE_FIELD_DELETE'

module.exports = {
    fields: () => {
        const program = new Command('fields')
        program.alias('fd').description('Manage fields in a collection')

        program
            .command('insert')
            .alias('i')
            .description('Insert a field to each item inside a collection')
            .requiredOption('-c, --collection <collection_path>', '[ Required ] Path to the collection')
            .requiredOption('-f, --field <field_name>', '[ Required ] Field name to insert')
            .option('-v, --value <value>', '[ Optional ] Default value to assign')
            .option('-p, --preview', '[ Optional ] Preview actions to execute, without to execute them')
            .action(args => {
                manageField(MANAGE_FIELD_INSERT, args.collection, args.field, args.value, args.preview)
            })

        program
            .command('update')
            .alias('u')
            .description('Update a field of each item inside a collection')
            .requiredOption('-c, --collection <collection_path>', '[ Required ] Path to the collection')
            .requiredOption('-f, --field <field_name>', '[ Required ] Field name to insert')
            .requiredOption('-v, --value <value>', '[ Optional ] Default value to assign')
            .option('-p, --preview', '[ Optional ] Preview actions to execute, without to execute them')
            .action(args => {
                manageField(MANAGE_FIELD_UPDATE, args.collection, args.field, args.value, args.preview)
            })

        program
            .command('delete')
            .alias('d')
            .description('Delete a field from each item inside a collection')
            .requiredOption('-c, --collection <collection_path>', '[ Required ] Path to the collection')
            .requiredOption('-f, --field <field_name>', '[ Required ] Field name to insert')
            .option('-p, --preview', '[ Optional ] Preview actions to execute, without to execute them')
            .action(args => {
                manageField(MANAGE_FIELD_DELETE, args.collection, args.field, null, args.preview)
            })

        return program
    },
}

const manageField = (action, path, field, value, preview) => {
    actionTitle(action)
    const spinner = new Spinner(chalk.blue.bold('Getting data from Firebase...'), [
        '⣾',
        '⣽',
        '⣻',
        '⢿',
        '⡿',
        '⣟',
        '⣯',
        '⣷',
    ])
    spinner.start()

    if (action === MANAGE_FIELD_DELETE && path === '/') {
        log(
            chalk.bgYellow.black.bold(' Warning: ') +
                chalk.yellow(
                    ` Be careful, with path "/" you will remove the entire database. ${chalk.green.bold(
                        '[ Operation aborted ]'
                    )} \n`
                )
        )
        spinner.stop()
        return
    }

    const callback = dataItems => {
        spinner.stop()
        try {
            if (dataItems.match('Error')) {
                log(
                    chalk.bgRed.black.bold(' Error: ') +
                        chalk.red(' An error occur when trying to retrieve database items \n')
                )
                log(chalk.bgYellow.black.bold(' Details: ') + ` ${dataItems} \n`)
                return
            }

            dataItems = JSON.parse(dataItems)

            if (typeof dataItems !== 'object') {
                log(
                    chalk.bgRed.black('Error: ') +
                        chalk.red('The data retrieved have not the right format or have inconsistency \n')
                )
                return
            }

            if (preview) {
                log(chalk.bgYellow.black.bold(' PREVIEW MODE '))
            }

            let numberOfChanges = 0

            for (let key in dataItems) {
                if (
                    // If INSERT and the field not exists
                    action === MANAGE_FIELD_INSERT &&
                    (dataItems[key] === undefined || dataItems[key][field] === undefined)
                ) {
                    numberOfChanges++
                    manageFieldInItem(action, path, key, field, value, preview)
                    //
                } else if (
                    // If UPDATE and the fields exists and its value is different that VALUE
                    action === MANAGE_FIELD_UPDATE &&
                    dataItems[key] !== undefined &&
                    dataItems[key][field] !== undefined &&
                    dataItems[key][field] !== value
                ) {
                    numberOfChanges++
                    manageFieldInItem(action, path, key, field, value, preview)
                    //
                } else if (
                    // If DELETE and the field exists
                    action === MANAGE_FIELD_DELETE &&
                    dataItems[key] !== undefined &&
                    dataItems[key][field] !== undefined
                ) {
                    numberOfChanges++
                    manageFieldInItem(action, path, key, field, value, preview)
                }
            }

            if (numberOfChanges === 0) {
                log(chalk.bgGreen.black(chalk.bold(' All data is OK. ') + 'No need to update the Database '))
            }
        } catch (error) {
            log(chalk.red(`[ ${error} ]`))
        }

        log('')
    }

    run(`firebase database:get ${path}`, callback, true)

    const manageFieldInItem = (action, path, itemId, field, value, preview) => {
        value = value == null ? '' : value

        log(
            action === MANAGE_FIELD_DELETE
                ? chalk.green(
                      `Remove field ${chalk.bgGreen.black(` ${field} `)} from path ${chalk.bgBlue.black(
                          ` ${path}/${itemId} `
                      )}`
                  )
                : chalk.green(
                      `Set data ${chalk.bgGreen.black(` { "${field}":"${value}" } `)} in path ${chalk.bgBlue.black(
                          ` ${path}/${itemId} `
                      )}`
                  )
        )

        if (!preview) {
            let command = ''

            if (action === MANAGE_FIELD_DELETE) {
                command = `firebase database:remove ${path}/${itemId}/${field} --confirm`
            } else {
                command = `firebase database:update ${path}/${itemId} --confirm --data '{ "${field}":"${value}" }'`
            }

            run(command, undefined, true)
        }
    }
}

const actionTitle = action => {
    switch (action) {
        case MANAGE_FIELD_INSERT:
            log(chalk.bgGreen.black.bold(' Insert a field to each item inside a collection \n'))
            break
        case MANAGE_FIELD_UPDATE:
            log(chalk.bgGreen.black.bold(' Update a field of each item inside a collection \n'))
            break
        case MANAGE_FIELD_DELETE:
            log(chalk.bgGreen.black.bold(' Delete a field from each item inside a collection \n'))
            break
    }
}
