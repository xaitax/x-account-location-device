#!/usr/bin/env node

/**
 * Cross-platform zip script for packaging the extension
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const browser = process.argv[2] || 'chrome';
const distDir = join(__dirname, '..', 'dist', browser);
const outputFile = join(__dirname, '..', 'dist', `x-posed-${browser}.zip`);

if (!existsSync(distDir)) {
    console.error(`Error: dist/${browser} directory not found. Run build:${browser} first.`);
    process.exit(1);
}

// Ensure output directory exists
const outputDir = dirname(outputFile);
if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
}

const output = createWriteStream(outputFile);
const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
    // Read the final size from disk (ground truth). archive.pointer() can
    // intermittently report 0 in this handler depending on stream timing.
    let bytes = archive.pointer();
    try {
        const onDisk = statSync(outputFile).size;
        if (onDisk > 0) bytes = onDisk;
    } catch { /* keep the pointer() fallback */ }
    const size = (bytes / 1024).toFixed(2);
    console.log(`✅ Created ${outputFile} (${size} KB)`);
});

archive.on('error', (err) => {
    console.error('Error creating zip:', err);
    process.exit(1);
});

archive.pipe(output);
archive.directory(distDir, false);
archive.finalize();