"use strict";
const Promise = require("bluebird");
const _ = require('lodash');

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

Promise.fromCallback(octo.orgs(process.env.GITHUB_ORG).fetch)
  .then((org) => fetchAll(org.repos.fetch))
  .filter(result => result.private === false)
  .map(getReadme)
  .map(getContributing)
  .map(getChangelog)
  .map(getMasterBranchProtection)
  .map(formatResult)
  .tap(pushResultsToGithub)
