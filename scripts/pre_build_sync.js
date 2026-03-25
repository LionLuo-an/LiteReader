const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const buildDir = path.join(rootDir, 'lite.reader/app/server');

const filesToCheck = ['server.js', 'package.json'];

function getFileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
}

console.log('[Sync Check] 正在检查构建目录是否有未保存的更改...');

if (!fs.existsSync(buildDir)) {
    console.log('[Sync Check] 构建目录不存在，跳过同步。');
    process.exit(0);
}

let syncedCount = 0;

filesToCheck.forEach(file => {
    const srcPath = path.join(buildDir, file);
    const destPath = path.join(backendDir, file);

    if (fs.existsSync(srcPath)) {
        // 如果目标文件不存在，直接复制
        if (!fs.existsSync(destPath)) {
            console.log(`[Sync Check] 在源码目录中未找到 ${file}，正在从构建目录恢复...`);
            fs.copyFileSync(srcPath, destPath);
            syncedCount++;
            return;
        }

        // 如果都存在，比较内容
        const srcHash = getFileHash(srcPath);
        const destHash = getFileHash(destPath);

        if (srcHash !== destHash) {
            const srcStat = fs.statSync(srcPath);
            const destStat = fs.statSync(destPath);

            // 只有当构建目录的文件更新时才覆盖
            // 注意：增加 2秒 的容差，因为某些文件系统精度问题，或者复制时的延迟
            if (srcStat.mtime > destStat.mtime) {
                console.log(`[Sync Check] 发现 ${file} 在构建目录中有新修改。`);
                console.log(`   构建目录: ${srcStat.mtime.toLocaleString()}`);
                console.log(`   源码目录: ${destStat.mtime.toLocaleString()}`);
                console.log(`   >> 正在同步回源码目录...`);

                try {
                    fs.copyFileSync(srcPath, destPath);
                    syncedCount++;
                } catch (e) {
                    console.error(`[Sync Check] 同步 ${file} 失败:`, e.message);
                }
            } else {
                console.log(`[Sync Check] ${file} 内容不同，但源码目录较新或时间相同，跳过覆盖。`);
            }
        }
    }
});

if (syncedCount > 0) {
    console.log(`[Sync Check] 成功同步了 ${syncedCount} 个文件回源码目录。`);
} else {
    console.log('[Sync Check] 源码目录已是最新，无需同步。');
}
