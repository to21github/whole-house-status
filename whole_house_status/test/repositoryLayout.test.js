const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function findRepositoryRoot(startDirectory) {
  let directory = startDirectory;

  while (true) {
    if (fs.existsSync(path.join(directory, 'repository.yaml'))) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
}

test('Home Assistant repository layout exposes the Whole House Status add-on', () => {
  const repositoryRoot = findRepositoryRoot(__dirname);

  assert.ok(repositoryRoot, 'repository.yaml must exist in an ancestor directory');

  const repositoryManifest = fs.readFileSync(
    path.join(repositoryRoot, 'repository.yaml'),
    'utf8',
  );
  assert.match(repositoryManifest, /^name: Whole House Status$/m);
  assert.match(repositoryManifest, /^url: https:\/\/github\.com\/to21github\/whole-house-status$/m);
  assert.match(repositoryManifest, /^maintainer: to21github$/m);

  const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
  assert.match(
    readme,
    /Install \*\*Whole House Status\*\*\.\n5\. Start the add-on\.\n6\. Configure the add-on\.\n7\. Restart the add-on\.\n8\. Open `全屋设备状态` from the sidebar\./,
  );

  for (const relativePath of [
    'whole_house_status/config.yaml',
    'whole_house_status/CHANGELOG.md',
    'whole_house_status/Dockerfile',
    'whole_house_status/package.json',
  ]) {
    assert.ok(
      fs.existsSync(path.join(repositoryRoot, relativePath)),
      `${relativePath} must exist`,
    );
  }

  const config = fs.readFileSync(path.join(repositoryRoot, 'whole_house_status', 'config.yaml'), 'utf8');
  const changelog = fs.readFileSync(path.join(repositoryRoot, 'whole_house_status', 'CHANGELOG.md'), 'utf8');
  assert.match(config, /^version: "0\.1\.13"$/m);
  assert.match(changelog, /^## 0\.1\.13$/m);
});
