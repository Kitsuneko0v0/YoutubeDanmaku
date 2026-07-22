'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');
const runtimeFiles = [
  'src/danmaku-engine.js',
  'src/i18n.js',
  'src/content.js',
  'src/content.css'
];
const iconFiles = [
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png'
];
const localeFiles = [
  '_locales/en/messages.json',
  '_locales/zh_CN/messages.json',
  '_locales/zh_TW/messages.json',
  '_locales/ja/messages.json',
  '_locales/ko/messages.json'
];
const distributionFiles = [...runtimeFiles, ...iconFiles, ...localeFiles];

function toDistributionName(file) {
  return path.basename(file);
}

function toDistributionPath(file) {
  return iconFiles.includes(file) || localeFiles.includes(file)
    ? file
    : toDistributionName(file);
}

function createDistributionManifest(manifest) {
  return {
    ...manifest,
    content_scripts: manifest.content_scripts.map((contentScript) => ({
      ...contentScript,
      js: contentScript.js?.map(toDistributionName),
      css: contentScript.css?.map(toDistributionName)
    }))
  };
}

async function build() {
  if (path.dirname(distDirectory) !== projectRoot || path.basename(distDirectory) !== 'dist') {
    throw new Error('Refusing to build outside the project dist directory.');
  }

  const manifestPath = path.join(projectRoot, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const distributionManifest = createDistributionManifest(manifest);

  await fs.rm(distDirectory, { recursive: true, force: true });
  await fs.mkdir(distDirectory, { recursive: true });
  await fs.writeFile(
    path.join(distDirectory, 'manifest.json'),
    `${JSON.stringify(distributionManifest, null, 2)}\n`,
    'utf8'
  );

  await Promise.all(distributionFiles.map(async (file) => {
    const destination = path.join(distDirectory, toDistributionPath(file));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(projectRoot, file), destination);
  }));

  console.log(`Built extension in ${path.relative(projectRoot, distDirectory)}/`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
