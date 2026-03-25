const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetServerDir = path.resolve(__dirname, '../lite.reader/app/server');

// Determine platform from manifest
const manifestPath = path.resolve(__dirname, '../lite.reader/manifest');
let targetPlatform = 'x86';
try {
    if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf8');
        const match = content.match(/^platform=(.+)$/m);
        if (match) {
            const p = match[1].trim();
            if (p === 'arm') targetPlatform = 'arm';
        }
    }
} catch (e) {
    console.warn('Could not read manifest, defaulting to x86');
}
console.log(`Target Platform: ${targetPlatform}`);

const sqliteDir = path.join(targetServerDir, 'node_modules', 'sqlite3');
const releaseDir = path.join(sqliteDir, 'build', 'Release');

// Ensure sqlite3 exists (it should after npm install)
if (!fs.existsSync(sqliteDir)) {
    console.error('sqlite3 module not found. Run npm install first.');
    process.exit(1);
}

const version = 'v5.1.7';
// Use npmmirror for better connectivity in China
const arch = targetPlatform === 'arm' ? 'linux-arm64' : 'linux-x64';
const fileName = `sqlite3-${version}-napi-v6-${arch}.tar.gz`;
const url = `https://npmmirror.com/mirrors/sqlite3/${version}/${fileName}`;
const tarPath = path.join(targetServerDir, fileName);

console.log(`Downloading ${url}...`);

try {
    // Use curl.exe which handles redirects and HTTPS correctly
    execSync(`curl.exe -L -o "${tarPath}" "${url}"`, { stdio: 'inherit' });
} catch (e) {
    console.error('Download failed:', e);
    process.exit(1);
}

console.log('Download complete. Extracting...');

// Ensure build/Release exists
fs.mkdirSync(releaseDir, { recursive: true });

// Delete existing binary to ensure we are not fooled by cache or failure to overwrite
const targetBinary = path.join(releaseDir, 'node_sqlite3.node');
if (fs.existsSync(targetBinary)) {
    console.log('Deleting existing Windows binary...');
    fs.unlinkSync(targetBinary);
}

// Extract using tar
const tempExtractDir = path.join(targetServerDir, 'sqlite_temp');
if (fs.existsSync(tempExtractDir)) fs.rmSync(tempExtractDir, { recursive: true, force: true });
fs.mkdirSync(tempExtractDir, { recursive: true });

try {
    // Check tarball size
    const stats = fs.statSync(tarPath);
    console.log(`Tarball size: ${stats.size} bytes`);

    execSync(`tar -xf "${tarPath}" -C "${tempExtractDir}"`);

    // List extracted files for debugging
    console.log('Extracted files:');
    try {
        execSync(`dir /s "${tempExtractDir}"`, { stdio: 'inherit', shell: 'cmd.exe' });
    } catch (e) { } // ignore dir error

    // Find node_sqlite3.node
    let found = false;
    function findAndCopy(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                findAndCopy(fullPath);
            } else if (file === 'node_sqlite3.node') {
                console.log(`Found binary at ${fullPath}`);

                // Check magic bytes
                const fd = fs.openSync(fullPath, 'r');
                const buffer = Buffer.alloc(4);
                fs.readSync(fd, buffer, 0, 4, 0);
                fs.closeSync(fd);
                console.log(`Magic bytes: ${buffer.toString('hex')}`);

                if (buffer.toString('hex') === '7f454c46') {
                    console.log('Verified ELF header. Copying...');
                } else {
                    console.warn('WARNING: Not an ELF file!');
                }

                console.log(`Copying to ${path.join(releaseDir, 'node_sqlite3.node')}`);
                fs.copyFileSync(fullPath, path.join(releaseDir, 'node_sqlite3.node'));
                found = true;
            }
        }
    }
    findAndCopy(tempExtractDir);

    if (!found) {
        throw new Error('node_sqlite3.node not found in archive');
    }

    console.log('Patch success!');
} catch (e) {
    console.error('Extraction failed:', e);
    process.exit(1);
} finally {
    // Cleanup
    try {
        if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
        if (fs.existsSync(tempExtractDir)) fs.rmSync(tempExtractDir, { recursive: true, force: true });
    } catch (e) { }
}
