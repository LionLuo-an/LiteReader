const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];

if (!newVersion) {
  console.error('Please provide a new version number (e.g., 1.2.0)');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

// 1. Update package.json
const packageJsonPath = path.join(projectRoot, 'package.json');
try {
  let content = fs.readFileSync(packageJsonPath, 'utf8');
  // Strip BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const packageJson = JSON.parse(content);
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
  console.log(`Updated package.json to version ${newVersion}`);
} catch (err) {
  console.error(`Error updating package.json: ${err.message}`);
  process.exit(1);
}

// 2. Update android/app/build.gradle
const buildGradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');
try {
  let buildGradleContent = fs.readFileSync(buildGradlePath, 'utf8');
  
  // Strip BOM if present
  if (buildGradleContent.charCodeAt(0) === 0xFEFF) {
    buildGradleContent = buildGradleContent.slice(1);
  }
  
  // Update versionName
  buildGradleContent = buildGradleContent.replace(
    /versionName "[^"]*"/,
    `versionName "${newVersion}"`
  );
  
  // Update versionCode (increment by 1)
  buildGradleContent = buildGradleContent.replace(
    /versionCode (\d+)/,
    (match, code) => `versionCode ${parseInt(code, 10) + 1}`
  );

  fs.writeFileSync(buildGradlePath, buildGradleContent, 'utf8');
  console.log(`Updated build.gradle to version ${newVersion}`);
} catch (err) {
  console.error(`Error updating build.gradle: ${err.message}`);
  process.exit(1);
}

// 3. Update src/components/Profile.jsx
const profilePath = path.join(projectRoot, 'src', 'components', 'Profile.jsx');
try {
  let profileContent = fs.readFileSync(profilePath, 'utf8');
  
  // Update useState('v...')
  // Matches useState('v1.0.0') or useState("v1.0.0")
  profileContent = profileContent.replace(
    /useState\(['"]v[^'"]+['"]\)/,
    `useState('v${newVersion}')`
  );

  fs.writeFileSync(profilePath, profileContent, 'utf8');
  console.log(`Updated Profile.jsx to version ${newVersion}`);
} catch (err) {
  console.error(`Error updating Profile.jsx: ${err.message}`);
  process.exit(1);
}

console.log('Version update completed successfully.');
