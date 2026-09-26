/** Validate local browser artifacts without loading an account or contacting a service. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const requested = process.argv.slice(2);
const browsers = requested.length ? requested : ['chrome', 'firefox'];
const read = filename => fs.readFileSync(path.join(root, filename));
const filesBelow = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesBelow(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

for (const browser of browsers) {
    assert.ok(['chrome', 'firefox'].includes(browser), 'Expected chrome or firefox');
    const prefix = `dist/${browser}/`;
    const source = JSON.parse(read(`src/manifest.${browser}.json`));
    const manifest = JSON.parse(read(`${prefix}manifest.json`));
    assert.deepEqual(manifest, { ...source, version: pkg.version }, `${browser}: stale manifest`);
    const styles = manifest.content_scripts.flatMap(entry => entry.css || []);
    assert.equal(styles[0], 'styles/graphite-theme.css', `${browser}: theme must load first`);
    assert.equal(new Set(styles).size, styles.length, `${browser}: duplicate stylesheet registration`);
    for (const asset of [...styles, 'popup/popup.html', 'popup/popup.css', 'options/options.html', 'options/options.css']) {
        assert.ok(read(`src/${asset}`).equals(read(`${prefix}${asset}`)), `${browser}: stale ${asset}`);
    }
    const scripts = ['background.js', 'content.js', 'page-script.js', 'popup/popup.js', 'options/options.js'];
    for (const script of scripts) {
        const code = read(`${prefix}${script}`).toString('utf8');
        assert.ok(!code.includes('__BUILD_VERSION__'), `${browser}: unresolved build version in ${script}`);
        new Function(code); // Parse the IIFE, never execute it.
    }
    for (const entry of manifest.content_scripts) {
        for (const script of entry.js || []) assert.ok(fs.existsSync(path.join(root, prefix, script)));
    }
    for (const html of ['popup/popup.html', 'options/options.html']) {
        const text = read(`${prefix}${html}`).toString('utf8');
        for (const match of text.matchAll(/(?:src|href)="([^"#]+\.(?:css|js|png))"/g)) {
            assert.ok(fs.existsSync(path.resolve(root, prefix, path.dirname(html), match[1])), `${browser}: missing ${match[1]}`);
        }
    }
    const staticAssets = ['third-party/LUCIDE-LICENSE.txt', 'third-party/NATURAL-EARTH-NOTICE.txt',
        ...fs.readdirSync(path.join(root, 'icons')).map(name => `icons/${name}`)];
    for (const asset of staticAssets) {
        assert.ok(read(asset).equals(read(`${prefix}${asset}`)), `${browser}: stale ${asset}`);
    }
    const allowed = new Set(['manifest.json', ...scripts,
        ...fs.readdirSync(path.join(root, 'src/styles')).filter(name => name.endsWith('.css')).map(name => `styles/${name}`),
        'popup/popup.html', 'popup/popup.css', 'options/options.html', 'options/options.css',
        ...staticAssets]);
    for (const asset of allowed) {
        assert.ok(fs.existsSync(path.join(root, prefix, asset)), `${browser}: missing ${asset}`);
    }
    for (const file of filesBelow(path.join(root, prefix))) {
        const relative = path.relative(path.join(root, prefix), file).replaceAll('\\', '/');
        assert.ok(allowed.has(relative), `${browser}: unexpected packaged file ${relative}`);
    }
    console.log(`${browser} ${pkg.version}: current assets, valid scripts, no private or stale files`);
}
