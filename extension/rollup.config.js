/**
 * Rollup Configuration for X-Posed Extension
 * Builds both Chrome (MV3) and Firefox compatible versions
 *
 * VERSION MANAGEMENT:
 * The single source of truth for version is package.json
 * At build time, this version is injected into:
 * - All bundled JS files via @rollup/plugin-replace
 * - The manifest.json via transform
 */

import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import copy from 'rollup-plugin-copy';
import { readFileSync } from 'fs';

const production = !process.env.ROLLUP_WATCH;
const browser = process.env.BROWSER || 'chrome';
const isFirefox = browser === 'firefox';
const outputDir = isFirefox ? 'dist/firefox' : 'dist/chrome';
const manifestFile = isFirefox ? 'src/manifest.firefox.json' : 'src/manifest.chrome.json';

// SINGLE SOURCE OF TRUTH: Read version from package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const VERSION = pkg.version;

console.log(`🚀 Building X-Posed v${VERSION} for ${browser}...`);

// Version replacement plugin - injects VERSION into all bundles
const versionReplace = replace({
    preventAssignment: true,
    values: {
        // Replace the placeholder in constants.js and any other file
        '__BUILD_VERSION__': VERSION,
        // Also replace hardcoded version strings for safety
        "'2.0.2'": `'${VERSION}'`,
        '"2.0.2"': `"${VERSION}"`
    }
});

// Common plugins applied to all bundles
const plugins = [
    versionReplace,
    resolve({
        browser: true
    }),
    commonjs(),
    production && terser({
        format: {
            comments: false
        }
    })
];

// Copy static assets with manifest version injection
const copyPlugin = copy({
    targets: [
        // Manifest (browser-specific) - transform to inject version from package.json
        {
            src: manifestFile,
            dest: outputDir,
            rename: 'manifest.json',
            transform: contents => {
                const manifest = JSON.parse(contents.toString());
                manifest.version = VERSION;
                return JSON.stringify(manifest, null, 2);
            }
        },
        // Icons
        { src: 'icons/*', dest: `${outputDir}/icons` },
        // Styles
        { src: 'src/styles/*.css', dest: `${outputDir}/styles` },
        // Popup
        { src: 'src/popup/popup.html', dest: `${outputDir}/popup` },
        { src: 'src/popup/popup.css', dest: `${outputDir}/popup` },
        // Options
        { src: 'src/options/options.html', dest: `${outputDir}/options` },
        { src: 'src/options/options.css', dest: `${outputDir}/options` }
    ]
});

export default [
    // Background Service Worker
    {
        input: 'src/background/service-worker.js',
        output: {
            file: `${outputDir}/background.js`,
            format: 'iife',
            name: 'XPosedBackground',
            sourcemap: !production
        },
        plugins: [...plugins]
    },

    // Content Script (ISOLATED world) - bundle with inlined dynamic imports
    {
        input: 'src/content/content-script.js',
        output: {
            file: `${outputDir}/content.js`,
            format: 'iife',
            name: 'XPosedContent',
            sourcemap: !production,
            inlineDynamicImports: true
        },
        plugins: [...plugins]
    },

    // Page Script (MAIN world) - simple IIFE (uses common plugins with version replacement)
    {
        input: 'src/content/page-script.js',
        output: {
            file: `${outputDir}/page-script.js`,
            format: 'iife',
            sourcemap: !production
        },
        plugins: [...plugins]
    },

    // Popup Script
    {
        input: 'src/popup/popup.js',
        output: {
            file: `${outputDir}/popup/popup.js`,
            format: 'iife',
            name: 'XPosedPopup',
            sourcemap: !production,
            inlineDynamicImports: true
        },
        plugins: [...plugins, copyPlugin]
    },

    // Options Script
    {
        input: 'src/options/options.js',
        output: {
            file: `${outputDir}/options/options.js`,
            format: 'iife',
            name: 'XPosedOptions',
            sourcemap: !production,
            inlineDynamicImports: true
        },
        plugins: [...plugins]
    }
];