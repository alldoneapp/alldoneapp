const fs = require('fs')

const readFile = (path, callback) => {
    fs.readFile(path, { encoding: 'utf-8' }, (err, content) => {
        if (err) {
            throw err
        } else {
            callback(content)
        }
    })
}

const writeFile = (path, content) => {
    if (path && path !== '' && path !== '.' && path !== '..') {
        fs.writeFileSync(path, content)
    } else {
        console.log('ERROR: Invalid path file: ' + path)
    }
}

module.exports = {
    readFile,
    writeFile,
}
