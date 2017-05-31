const { spawn } = require('child_process');
const inquirer = require('inquirer');
const minimist = require('minimist');
const fs = require('fs');

const { log: l } = console;

const argv = minimist(process.argv.slice(2));
const [argPath = '', defaultProject = '', defaultModule = ''] = argv._;
const { gulp = null, script = null } = argv;

const currentDirectory = `${process.cwd()}`;
const rootDirectory = ((/^\//g).test(argPath)) ? argPath : currentDirectory + argPath;

const portfinder = require('portfinder');

const getProjectPath = project => `${rootDirectory}/${project}`;

const getModulePath = (project, module) => `${getProjectPath(project)}/public/${module}`;

if (!fs.existsSync(rootDirectory)) {
  l('Directory not found!');
  process.exit(1);
}


const hasPackageJson = path => fs.existsSync(`${path}/package.json`);

const isGulp = path => fs.existsSync(`${path}/Gulpfile.js`) || fs.existsSync(`${path}/gulpfile.js`);


const validate = path => isGulp(path) || hasPackageJson(path);

const findModules = project => fs.existsSync(`${rootDirectory}/${project}/public`) &&
        fs.readdirSync(`${rootDirectory}/${project}/public`).filter(
            dir => (/^.+-app$/).test(dir) && fs.statSync(getModulePath(project, dir)).isDirectory() && validate(getModulePath(project, dir)));

const projects = fs.readdirSync(rootDirectory).filter(dir => fs.statSync(getProjectPath(dir)).isDirectory() && fs.existsSync(`${getProjectPath(dir)}/artisan`) && findModules(dir).length);

if (!projects.length) {
  l('No Projects found');
  process.exit(1);
}


const getNpmScripts = (project, module) => {
  const { scripts } = require(`${getModulePath(project, module)}/package.json`);  // eslint-disable-line
  const { start: st = null } = scripts;

  const start = st ? 'start' : '';

  return [start, ...Object.keys(scripts).filter(s => s !== 'start')].filter(x => x);
};

const getAllMatches = (regex, str) => {
  let m;
  const result = [];
  while ((m = regex.exec(str)) !== null) {  // eslint-disable-line no-cond-assign
    if (m.index === regex.lastIndex) {
      regex.lastIndex += 1;
    }

    result.push(m);
  }

  return result;
};

const getGulpTasks = (project, module) => {
  const gulpFileContent = fs.readFileSync(`${getModulePath(project, module)}/Gulpfile.js`, 'utf8');
  const matches = getAllMatches(/gulp\.task\('(?!default\b)\b(\w+)'/g, gulpFileContent).map(r => r[1]).filter(x => x);
  return ['default', ...matches];
};

const defaultAnswer = {};

const questions = [{
  type: 'list',
  name: 'project',
  message: 'Select Project',
  choices: projects,
  when: (answers) => {
    if (defaultProject) {
      defaultAnswer.project = defaultProject;
      answers.project = defaultProject;
      return false;
    }
    return true;
  },
}, {
  type: 'list',
  name: 'module',
  message: 'Select Module',
  choices: answers => findModules(answers.project),
  when: (answers) => {
    if (defaultModule) {
      defaultAnswer.module = defaultModule;
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
  when: answers => !findModules(answers.project),
}, {
  type: 'list',
  name: 'gulpTask',
  message: 'Select the gulp task to run',
  choices: (answers) => {
    if (gulp) {
      defaultAnswer.gulp = gulp;
      answers.gulp = gulp;
      return false;
    }
    return getGulpTasks(answers.project, answers.module);
  },
  when: answers => isGulp(getModulePath(answers.project, answers.module)),
}, {
  type: 'list',
  name: 'scripts',
  message: 'Select the npm script to run',
  choices: ({ project, module }) => {
    l(project, module);
    return getNpmScripts(project, module);
  },
  when: (answers) => {
    if (script) {
      defaultAnswer.scripts = script;
      answers.scripts = script;
      return false;
    }

    return findModules(answers.project) && !isGulp(answers.project, answers.module);
  },
}];


inquirer.prompt(questions).then((answers) => {
  const gulpTask = answers.gulpTask || defaultAnswer.gulpTask;
  const module = answers.module || defaultAnswer.module;
  const project = answers.project || defaultAnswer.project;
  const scripts = answers.scripts || defaultAnswer.scripts;

  l(JSON.stringify(answers, null, '  '));


  let proc = null;
  portfinder.getPortPromise().then((port) => {
    l('Starting artisan serve');

    proc = spawn('php', ['artisan', 'serve', `--port=${port}`], { stdio: [0, 1, 2], cwd: getProjectPath(project) });
    proc.on('message', m => l(m));
    proc.on('exit', (code) => {
      if (code === 0) {
        l(`Artisan started on port ${port}`);
      } else {
        process.exit(1);
      }
    });
    proc.on('error', (...args) => {
      l(args);
      process.exit(1);
    });
    l(`Artisan running as ${proc.pid}`);
  });

  let nProc = null;

  if (gulpTask) {
    l('Starting gulp...');
    nProc = spawn('gulp', [gulpTask], { stdio: [0, 1, 2], cwd: getModulePath(project, module) });
  } else if (scripts) {
    l(`Starting npm run ${scripts}...`);
    nProc = spawn('npm', ['run', scripts], { stdio: [0, 1, 2], cwd: getModulePath(project, module) });
  }

  const cleanUp = () => {
    l('killing');
    nProc && nProc.kill(); // eslint-disable-line no-unused-expressions
    proc && proc.kill();   // eslint-disable-line no-unused-expressions
  };

  process.on('SIGINT', cleanUp);
});
