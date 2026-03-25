const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const rootDir = path.resolve(__dirname, '..');
const targetServerDir = path.join(rootDir, 'lite.reader/app/server');
const targetUiDir = path.join(rootDir, 'lite.reader/app/ui');

console.log('Building LightReader Package...');

// 1. Install Backend Dependencies for Linux (Production)
// 后端代码现在直接在 lite.reader/app/server 目录维护，无需复制
console.log('Installing Backend Dependencies for Linux (Production)...');
try {
    execSync(`${npmCmd} install --production --no-audit --registry=https://registry.npmmirror.com`, { cwd: targetServerDir, stdio: 'inherit' });

    // Patch sqlite3 for Linux x64
    console.log('Patching sqlite3 for Linux x64...');
    execSync('node scripts/patch_sqlite.js', { cwd: rootDir, stdio: 'inherit' });
} catch (e) {
    console.error('Error installing backend dependencies:', e);
    process.exit(1);
}

// 2. Build Frontend
console.log('Building Frontend...');
const frontendDir = path.join(rootDir, 'frontend');
const frontendDistDir = path.join(frontendDir, 'dist');

try {
    // Install frontend dependencies
    console.log('Installing Frontend Dependencies...');
    execSync(`${npmCmd} install --registry=https://registry.npmmirror.com`, { cwd: frontendDir, stdio: 'inherit' });

    // Build frontend
    console.log('Running Vite Build...');
    execSync(`${npmCmd} run build`, { cwd: frontendDir, stdio: 'inherit' });

    // Function to copy directory recursively
    const copyRecursiveSync = (src, dest) => {
        if (fs.existsSync(src)) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (let entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    copyRecursiveSync(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
    };

    // Copy to app/server/public (Critical for Express)
    console.log('Copying Frontend Artifacts to Server Public...');
    const targetServerPublicDir = path.join(targetServerDir, 'public');
    // Clean previous public dir if exists
    if (fs.existsSync(targetServerPublicDir)) fs.rmSync(targetServerPublicDir, { recursive: true, force: true });
    copyRecursiveSync(frontendDistDir, targetServerPublicDir);

    // Copy to app/ui (For Desktop App Structure)
    console.log('Copying Frontend Artifacts to UI...');
    copyRecursiveSync(frontendDistDir, targetUiDir);

    // Copy icons to app/ui/images
    const targetUiImagesDir = path.join(targetUiDir, 'images');
    if (!fs.existsSync(targetUiImagesDir)) fs.mkdirSync(targetUiImagesDir, { recursive: true });

    const iconSourceDir = path.join(rootDir, 'lite.reader');
    const icon64 = path.join(iconSourceDir, 'icon_64.png');
    const icon256 = path.join(iconSourceDir, 'icon_256.png');

    if (fs.existsSync(icon64)) {
        fs.copyFileSync(icon64, path.join(targetUiImagesDir, 'icon_48.png'));
        fs.copyFileSync(icon64, path.join(targetUiImagesDir, 'icon_64.png'));
    }
    if (fs.existsSync(icon256)) {
        fs.copyFileSync(icon256, path.join(targetUiImagesDir, 'icon_256.png'));
    }

} catch (e) {
    console.error('Error building frontend:', e);
    process.exit(1);
}

console.log('Build Complete. Ready for fnpack.');