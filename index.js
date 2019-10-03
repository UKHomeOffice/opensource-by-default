"use strict";
const Promise = require("bluebird");
const _ = require('lodash');
const readFile = Promise.promisify(require("fs").readFile);

const Octokat = require('octokat');

const octo = new Octokat({
  token: process.env.GITHUB_TOKEN,
  acceptHeader: "application/vnd.github.drax-preview+json" // Header for using Licence Preview API
});

const octo2 = new Octokat({
  token: process.env.GITHUB_TOKEN,
  acceptHeader: "application/vnd.github.loki-preview+json" // Header for using Licence Preview API
});

const fetchAll = (fn, args) => {
  let acc = []; // Accumulated results
  let p = new Promise((resolve, reject) => {
    fn(args).then((val) => {
      acc = acc.concat(val);
      if (val.nextPage) {
        return fetchAll(val.nextPage).then((val2) => {
          acc = acc.concat(val2);
          resolve(acc);
        }, reject);
      }
      resolve(acc);
    }, reject);
  });
  return p;
}

const formatResult = (result) => {
  return {
    name: result.fullName,
    "private": result.private,
    url: result.html.url,
    license: result.license,
    readme: result.readmefile,
    travis: result.readmefile && _.includes(result.readmefile, "travis-ci.org"),
    contributing: result.contributingfile,
    masterBranchProtection: result.masterBranchProtection
  }
};

const getReadme = (repo) =>
  repo.readme.read()
    .catch((error) => {
      return false;
    })
    .then((file) => _.set(repo, "readmefile", file))

const getContributing = (repo) =>
  getMDFile(repo, "CONTRIBUTING", "contributingfile")

const getChangelog = (repo) =>
  getMDFile(repo, "CHANGELOG", "changelogfile")

const getMDFile = (repo, path, place) =>
  getMaybeMD(repo, path)
    .then((file) => _.set(repo, place, file))

const getMaybeMD = (repo, path) =>
  repo.contents(path).read()
    .catch((error) => {
      if (path.substring(path.length - 3) !== ".md") {
        return getMaybeMD(repo, `${path}.md`)
      }
      return false;
    })

const pushResultsToGithub = (results) => {
  if (!process.env.GITHUB_REPO) {
    // if no repo specified just output the results
    console.log(results);
    return;
  }
  let repo = octo.repos(process.env.GITHUB_ORG, process.env.GITHUB_REPO);
  return repo.contents("repos.json").fetch({ref: "gh-pages"})
    .catch(error => {
      return false;
    })
    .then(file => file.sha || null)
    .then(sha => repo.contents('repos.json').add({
        message: 'Updating repos.json',
        content: new Buffer(JSON.stringify(results)).toString("base64"),
        branch: 'gh-pages',
        sha: sha
      })
    )
}

const getMasterBranchProtection = repo =>
  octo2.fromUrl(`${repo.url}/branches/master/protection`).fetch()
    .catch(error => {
      return false;
    })
    .then(masterBranchProtection => _.set(repo, "masterBranchProtection", masterBranchProtection));

const makeIssues = repos => {
  if (!process.env.GITHUB_ISSUES) {
    return;
  }
  return Promise.map(repos, repo => {
    if (!repo.license)
      makeOrGetIssue(repo, "license");
  })
}

const makeOrGetIssue = (repo, template) =>
  getTemplateIssue(template)
    .then(result => this.template = result)
    .then(() => fetchAll(repo.issues.fetch))
    .map(result => result.title)
    .then(titles => _.includes(titles, this.template.title))
    .then(issueExists => {
      if (issueExists) {
        return;
      }
      return createIssue(repo, this.template.title, this.template.body);
    })

const getTemplateIssue = template =>
  readFile(`./issueBodies/${template}.md`, {encoding: 'utf8'})
    .then(contents => {
      let splitup = contents.split(/\r\n|\r|\n/);
      return {
        title: splitup.shift(),
        body: splitup.join('\n')
      }
    });

const createIssue = (repo, title, body) =>
  repo.issues.create({
    title: title,
    body: body
  });

Promise.fromCallback(octo.orgs(process.env.GITHUB_ORG).fetch)
  .then((org) => fetchAll(org.repos.fetch))
  .filter(result => result.private === false)
  .filter(result => result.fork === false)
  .map(getReadme)
  .map(getContributing)
  .map(getChangelog)
  .map(getMasterBranchProtection)
  .tap(makeIssues)
  .map(formatResult)
  .tap(pushResultsToGithub)
