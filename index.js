var loaderUtils = require('loader-utils');
var path = require('path');
var typson = require('typson');
var Promise = require('bluebird');
var glob = require("glob-promise");
var Jsonator = require('jsonator');
var extend = require('extend');
var _s = require('underscore.string');
var eol = require('os').EOL;
var fs = Promise.promisifyAll(require('fs-extra'));
var wrapRef = p => '/// <reference path=\'' + p + '\'/>' + eol;
var j = path.join;
var root,
    bowerDir,
    componentsDir,
    appname,
    refPath,
    name,
    targetJson;

/* Save all typescript config file to .reference.ts to be used for schema and
 * default config json generation
 * @param {string} name - component name without team name prefix
 * @returns {Promise} Promise of target filed be saved
 */
function saveTsRef(name) {
    var p1 = j(componentsDir, name, 'src/config');
    var p2 = j(bowerDir, '**/build/config');
    /**
     * @function reducer to get a full list of typescript configuration
     */
    var reducer = (files, p) => glob(j(p, '**/!(test-)*.ts')).then(f => files.concat(f));

    return Promise.reduce([p1, p2], reducer, [])
        .then(list => list.map(n => path.relative(root, n)))
        .then(paths => paths.reduce((all, p) => all + wrapRef(p), ''))
        .then(refs => '// startref' + eol + refs + '// endref')
        .then(str => fs.writeFileAsync(refPath, str));
}

/**
 * Create JSON schema and default configuration from build/preview action
 * @param {string} name - component name without team name prefix
 * @returns {Promise} Promise of target files be created
 */
function createSchemeAndDefault(name) {
    var fullName = appname + '-' + name;
    var comDir = j(componentsDir, name);
    var configDir = j(comDir, 'src/config');
    var generatedDir = j(configDir, '.generated');
    var configJson = j(configDir, fullName + '.json');
    var defaultFile = j(generatedDir, '.defaults.json');
    var schemaFile = j(generatedDir, fullName + '.schema.json');
    var ts = [j(configDir, fullName + '.ts'), _s.camelize('-' + fullName)];
    var writeJson = fs.writeJsonAsync;
    var deepExtend = true;
    var jsonFmt = {
        spaces: 2
    };

    /**
     * @function write scheme object to schema json file
     */
    var writeSchema = schema => writeJson(schemaFile, schema, jsonFmt);

    /**
     * @function write jsonarator genarated schema file to .defaults.json
     */
    var writeDefault = schema => Promise.all([
            new Jsonator(schema).generateObjectForSchema(),
            fs.readJsonAsync(configJson)
        ])
        .then(data => extend(deepExtend, data[0], data[1]))
        .then(obj => writeJson(defaultFile, {
            [_s.camelize(fullName)]: obj
        }, jsonFmt));

    return new Promise(function(resolve) {
            typson.schema(ts[0], ts[1])
                .done(scheme => resolve(scheme));
        })
        .then(schema => new Jsonator(schema).getExpandedSchema())
        .tap(() => fs.ensureDirAsync(generatedDir))
        .tap(schema => delete schema.definitions)
        .then(schema => Promise.all([
            writeSchema(schema),
            writeDefault(schema)
        ]));
}

function existsFile(path) {
    try {
        fs.accessSync(path, fs.F_OK);
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = function() {
    var callback = this.async();
    var rawRequest = loaderUtils.getCurrentRequest(this);
    var srcFile = rawRequest.split('!').pop();

    //here srcFile is used as the main input to get other information
    //a better way is to get appname and context folder from bower.json
    var fullname = path.basename(srcFile, '.json');
    var tsFile = j(path.dirname(srcFile), fullname + '.ts');

    root = this.query.root || path.resolve(tsFile, '../../../../../');
    bowerDir = j(root, 'bower_components');
    componentsDir = j(root, 'components');
    appname = require(j(root, 'package.json')).name;
    refPath = j(root, '.references.ts');

    name = fullname.replace(appname + '-', '');
    targetJson = j(componentsDir, name, 'src/config/.generated/.defaults.json');
    var targetPath = path.dirname(targetJson);

    return fs.ensureDirAsync(targetPath)
        .then(() => {
            if (existsFile(tsFile)) {
                //compile ts to json
                return saveTsRef(name)
                    .then(() => createSchemeAndDefault(name));
            } else {
                //copy existing json file
                return fs.copyAsync(srcFile, targetJson, {
                    clobber: true
                });
            }
        })
        .then(() => callback(null, 'module.exports=' + fs.readFileSync(targetJson, 'utf8')));
};
