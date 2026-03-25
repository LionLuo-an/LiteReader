const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '../lite.reader/manifest');
const packageJsonPath = path.join(__dirname, '../lite.reader/app/server/package.json');

// Helper to read manifest version
function getManifestVersion() {
    if (!fs.existsSync(manifestPath)) {
        console.error(`[Error] Manifest not found at: ${manifestPath}`);
        process.exit(1);
    }
    const content = fs.readFileSync(manifestPath, 'utf8');
    const match = content.match(/^version=(.+)$/m);
    if (match) {
        return match[1].trim();
    }
    return null;
}

// Main logic
try {
    const version = getManifestVersion();
    if (!version) {
        console.error('[Error] Could not extract version from manifest');
        process.exit(1);
    }

    // 1. Update Server package.json
    if (!fs.existsSync(packageJsonPath)) {
        console.error(`[Error] package.json not found at: ${packageJsonPath}`);
        process.exit(1);
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    if (packageJson.version !== version) {
        console.log(`[Sync] Updating server package.json version from ${packageJson.version} to ${version}`);
        packageJson.version = version;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        console.log('[Sync] Server package.json updated!');
    } else {
        console.log(`[Sync] Server version match (${version}). No changes needed.`);
    }

    // 2. Update Frontend package.json
    const frontendPackagePath = path.join(__dirname, '../frontend/package.json');
    if (fs.existsSync(frontendPackagePath)) {
        const fePackageJson = JSON.parse(fs.readFileSync(frontendPackagePath, 'utf8'));
        if (fePackageJson.version !== version) {
            console.log(`[Sync] Updating frontend package.json version from ${fePackageJson.version} to ${version}`);
            fePackageJson.version = version;
            fs.writeFileSync(frontendPackagePath, JSON.stringify(fePackageJson, null, 2) + '\n');
            console.log('[Sync] Frontend package.json updated!');
        } else {
            console.log(`[Sync] Frontend version match (${version}). No changes needed.`);
        }
    } else {
        console.warn(`[Warn] Frontend package.json not found at: ${frontendPackagePath}`);
    }

    // 3. Update Profile.jsx (React State)
    const profilePath = path.join(__dirname, '../frontend/src/components/Profile.jsx');
    if (fs.existsSync(profilePath)) {
        let profileContent = fs.readFileSync(profilePath, 'utf8');
        // Regex to find: const [version, setVersion] = useState('v1.0.0');
        // We want to replace 'v1.0.0' with 'v{newVersion}'
        const versionRegex = /useState\('v?[\d\.]+'\)/;
        if (versionRegex.test(profileContent)) {
            const newContent = profileContent.replace(versionRegex, `useState('v${version}')`);
            if (newContent !== profileContent) {
                fs.writeFileSync(profilePath, newContent, 'utf8');
                console.log(`[Sync] Profile.jsx version updated to v${version}`);
            } else {
                console.log(`[Sync] Profile.jsx version already matches v${version}`);
            }
        } else {
            console.warn('[Warn] Could not find version state in Profile.jsx');
        }
    } else {
        console.warn(`[Warn] Profile.jsx not found at: ${profilePath}`);
    }

} catch (err) {
    console.error('[Error] Sync failed:', err);
    process.exit(1);
}
