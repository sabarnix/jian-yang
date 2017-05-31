const { spawn, spawnSync } = require('child_process');
const inquirer = require('inquirer');
const fs = require('fs');
const { log: l } = console;

const [execPath, execFile, argPath = '', defaultProject = '', defaultModule = '', defaultTask = ''] = process.argv;

const currentDirectory = `${process.cwd()}`;
const rootDirectory = ((/^\//g).test(argPath)) ? argPath : currentDirectory + argPath;

const portfinder = require('portfinder');

const getProjectPath = (project) => `${rootDirectory}/${project}`;

const getModulePath = (project, module) => `${getProjectPath(project)}/public/${module}`;

if (!fs.existsSync(rootDirectory)) {
    l(`Directory not found!`);
    process.exit(1);
}


const hasPackageJson = (path) => {
    return fs.existsSync(path + '/package.json');
}

const isGulp = (path) => {
    return fs.existsSync(`${path}/Gulpfile.js`) || fs.existsSync(`${path}/gulpfile.js`);
};



const validate = (path) => {
    return isGulp(path) || hasPackageJson(path);
}

const findModules = (project) => {
    return fs.existsSync(`${rootDirectory}/${project}/public`) &&
        fs.readdirSync(`${rootDirectory}/${project}/public`).filter(
            dir => (/^.+-app$/).test(dir) && fs.statSync(getModulePath(project, dir)).isDirectory() && validate(getModulePath(project, dir)));

};

const projects = fs.readdirSync(rootDirectory).filter(dir => {
    return fs.statSync(getProjectPath(dir)).isDirectory() && fs.existsSync(`${getProjectPath(dir)}/artisan`) && findModules(dir).length
});

if (!projects.length) {
    l('No Projects found');
    process.exit(1);
}



const getNpmScripts = (project, module) => {
    const { scripts } = require(`${getModulePath(project, module)}/package.json`);
    const { start: s = null } = scripts;

    const start = s ? 'start' : ''

    return [start, ...Object.keys(scripts).filter(script => script !== 'start')].filter(x => x);
}

const getAllMatches = (regex, str) => {
    let m;
    const result = [];
    while ((m = regex.exec(str)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }

        result.push(m);
    }

    return result;
}

const getGulpTasks = (project, module) => {
    var gulpFileContent = fs.readFileSync(`${getModulePath(project, module)}/Gulpfile.js`, "utf8");
    const matches = getAllMatches(/gulp\.task\(\'(?!default\b)\b(\w+)\'/g, gulpFileContent).map(r => r[1]).filter(x => x);
    return ['default', ...matches];
};


const questions = [{
    type: 'list',
    name: 'project',
    message: 'Select Project',
    choices: projects,
    when: (answers) => {
        if (defaultProject) {
            answers.project = defaultProject;
            return false;
        }
        return true;
    }
}, {
    type: 'list',
    name: 'module',
    message: 'Select Module',
    choices: (answers) => {
        return findModules(answers.project);
    },
    when: (answers) => {
        if (defaultModule) {
            answers.module = defaultModule;
            return false;
        }
        return findModules(answers.project);
    },
}, {
    type: 'confirm',
    name: 'startArtOnly',
    message: 'No Modules found, Do you want to start artisan?',
    default: true,
    when: (answers) => {
        return !findModules(answers.project);
    },
}, {
    type: 'list',
    name: 'gulpTask',
    message: 'Select the gulp task to run',
    choices: (answers) => {
        return getGulpTasks(answers.project, answers.module);
    },
    when: (answers) => {
        return isGulp(getModulePath(answers.project, answers.module));
    },
}, {
    type: 'list',
    name: 'scripts',
    message: 'Select the npm script to run',
    choices: ({ project, module }) => {
        l(project, module);
        return getNpmScripts(project, module);
    },
    when: (answers) => {
        return findModules(answers.project) && !isGulp(answers.project, answers.module);
    }
}];



inquirer.prompt(questions).then(function(answers) {

    const { gulpTask, module, project, startArtOnly = false, scripts } = answers;

    l(JSON.stringify(answers, null, '  '));


    let proc = null
    portfinder.getPortPromise().then(port => {
        l('Starting artisan serve');
        const proc = spawn('php', ['artisan', 'serve', '--port=' + port], { stdio: [0, 1, 2], cwd: getProjectPath(project) });
        proc.on('message', (m) => l(m));
        proc.on('exit', (code) => {
            if (code === 0) {
                l('Artisan started on port ' + port);
            } else {
                process.exit(1);
            }
        });
        proc.on('error', () => {
            process.exit(1);
        })
        l("Artisan running as " + proc.pid);
    });

    let nProc = null;

    if (gulpTask) {
        l('Starting gulp...');
        nProc = spawn('gulp', [gulpTask], { stdio: [0, 1, 2], cwd: getModulePath(project, module) });
    } else if (scripts) {
        l('Starting npm run ' + scripts + '...');
        nProc = spawn('npm', ['run', scripts], { stdio: [0, 1, 2], cwd: getModulePath(project, module) });
    }

    const cleanUp = (...args) => {
        l('killing');
        nProc && nProc.kill();
        proc && proc.kill();
    };

    process.on('SIGINT', cleanUp);

});