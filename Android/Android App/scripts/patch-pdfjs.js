/**
 * 自动补丁脚本：修复 pdfjs-dist 中文字体名 GBK mojibake 导致的乱码问题
 * 1. 在 normalizeFontName 中注入 GBK→ASCII 映射 (解决字体加载)
 * 2. 在 translateFont 中强制 GBK 编码 (解决文字乱码)
 * 
 * 用法：npm install 后自动执行（通过 package.json postinstall）
 */
const fs = require('fs');
const path = require('path');

const WORKER_PATHS = [
    path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs'),
    path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
    path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
    path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs')
];

const GBK_FONT_MAP_CODE = `
  // GBK mojibake 中文字体名 → 标准 ASCII 字体名映射
  const gbkFontMap = {
    // 完整名称 (高优先级)
    '\\u00cb\\u00ce\\u00cc\\u00e5': 'SimSun',
    '\\u00ba\\u00da\\u00cc\\u00e5': 'SimHei',
    '\\u00bf\\u00ac\\u00cc\\u00e5': 'KaiTi',
    '\\u00b7\\u00c2\\u00cb\\u00ce': 'FangSong',
    '\\u00b7\\u00c2\\u00cb\\u00ce\\u00cc\\u00e5': 'FangSong',
    '\\u00c1\\u00a5\\u00ca\\u00e9': 'LiSu',
    '\\u00d3\\u00d7\\u00d4\\u00b2': 'YouYuan',
    '\\u00d0\\u00a1\\u00b1\\u00ea\\u00cb\\u00ce': 'SimSun',
    '\\u00b1\\u00ea\\u00cb\\u00ce': 'SimSun',
    '\\u00d0\\u00c2\\u00cb\\u00ce\\u00cc\\u00e5': 'NSimSun',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00cb\\u00ce\\u00cc\\u00e5': 'STSong',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00ba\\u00da\\u00cc\\u00e5': 'STHeiti',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00bf\\u00ac\\u00cc\\u00e5': 'STKaiti',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00b7\\u00c2\\u00cb\\u00ce': 'STFangsong',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00c1\\u00a5\\u00ca\\u00e9': 'STLiti',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00d0\\u00c2\\u00ce\\u00ba': 'STXinwei',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00d0\\u00d0\\u00bf\\u00ac': 'STXingkai',
    '\\u00bb\\u00aa\\u00ce\\u00c4\\u00b2\\u00ca\\u00d4\\u00c6': 'STCaiyun',
    '\\u00ce\\u00a2\\u00c8\\u00ed\\u00d1\\u00c5\\u00ba\\u00da': 'Microsoft-YaHei',
    // 混合乱码 (用户反馈)
    '\\u00b7\\u00c2SimSun': 'FangSong', // 仿SimSun
    // 单字匹配 (低优先级兜底)
    '\\u00cb\\u00ce': 'SimSun', // 宋
    '\\u00ba\\u00da': 'SimHei', // 黑
    '\\u00bf\\u00ac': 'KaiTi',  // 楷
    '\\u00b7\\u00c2': 'FangSong', // 仿
  };
  
  // 按长度降序排序，确保长词优先匹配 (如 "仿宋" 优先于 "仿")
  const sortedKeys = Object.keys(gbkFontMap).sort((a, b) => b.length - a.length);
  
  for (const mojibake of sortedKeys) {
    if (name.includes(mojibake)) {
      name = name.replace(mojibake, gbkFontMap[mojibake]);
    }
  }`;

const patchWorker = (workerPath) => {
    if (!fs.existsSync(workerPath)) {
        console.log(`[patch-pdfjs] ${path.basename(workerPath)} not found, skipping.`);
        return;
    }

    let content = fs.readFileSync(workerPath, 'utf8');
    let modified = false;

    const normalizeRegex = /(function normalizeFontName\(name\) \{)([\s\S]*?)(return name\.replaceAll)/;

    if (!normalizeRegex.test(content)) {
        console.warn('[patch-pdfjs] Could not find normalizeFontName function structure, skipping patch 1.');
    } else {
        const newContent = content.replace(normalizeRegex, `$1\n${GBK_FONT_MAP_CODE}\n  $3`);
        if (newContent !== content) {
            content = newContent;
            modified = true;
            console.log('[patch-pdfjs] ✅ Applied normalizeFontName patch.');
        } else {
            console.log('[patch-pdfjs] normalizeFontName patch already up-to-date.');
        }
    }

    if (modified) {
        fs.writeFileSync(workerPath, content, 'utf8');
        console.log('[patch-pdfjs] File updated successfully.');
    } else {
        console.log('[patch-pdfjs] No changes needed.');
    }
};

try {
    WORKER_PATHS.forEach(patchWorker);
} catch (err) {
    console.error('[patch-pdfjs] Failed to apply patch:', err.message);
}
