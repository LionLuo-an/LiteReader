const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(__dirname, '../lite.reader');

function convertToLF(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        // Replace CRLF with LF, and also single CR with LF just in case
        const newContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        if (content !== newContent) {
            fs.writeFileSync(filePath, newContent);
            console.log(`[FIXED] Converted CRLF to LF: ${path.relative(targetDir, filePath)}`);
        }
    } catch (e) {
        console.error(`[ERROR] Failed to convert ${filePath}:`, e.message);
    }
}

function scanDir(dir) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else {
            // Check file extension or name
            const name = file.toLowerCase();
            const ext = path.extname(file).toLowerCase();

            // Files that MUST be LF
            if (
                name === 'manifest' ||
                name === 'main' || // cmd/main
                ext === '.sh' ||
                ext === '.json' ||
                ext === '.js' ||
                ext === '.css' ||
                ext === '.html' ||
                ext === '.md' ||
                name === 'privilege' ||
                name === 'resource'
            ) {
                convertToLF(fullPath);
            }
        }
    });
}

console.log('Scanning for files to convert CRLF -> LF...');
scanDir(targetDir);
console.log('Conversion complete.');