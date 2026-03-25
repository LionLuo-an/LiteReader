/**
 * MOBI 乱码分析脚本
 */
async function analyze() {
    const path = require('path');
    const mobiParser = await import('@lingo-reader/mobi-parser');

    const filepath = 'c:/Users/Administrator/Desktop/轻系列/轻阅读/认知觉醒：开启自我改变的原动力（当你认知觉醒，何惧焦虑迷茫！畅销书《反本能》作者卫蓝激赏力荐！） (周岭) (Z-Library).mobi';

    console.log('Loading MOBI...');
    const mobi = await mobiParser.initMobiFile(filepath);
    const spine = mobi.getSpine();
    console.log('Total chapters:', spine.length);

    // 检查几个章节
    for (let idx of [0, 1, 2, 3]) {
        if (idx >= spine.length) break;

        const ch = mobi.loadChapter(spine[idx].id);
        const raw = ch?.html || '';

        console.log(`\n=== Chapter ${idx}: ${spine[idx].id} ===`);
        console.log('Length:', raw.length);

        // 显示前100字符的 hex
        console.log('First 30 chars hex:');
        for (let i = 0; i < Math.min(30, raw.length); i++) {
            const code = raw.charCodeAt(i);
            const char = raw[i];
            // 标记可疑字符
            if (code < 0x20 && code !== 0x0A && code !== 0x0D && code !== 0x09) {
                console.log(`  [${i}] CTRL: 0x${code.toString(16).padStart(4, '0')}`);
            } else if (code >= 0x200B && code <= 0x206F) {
                console.log(`  [${i}] ZWSP: 0x${code.toString(16).padStart(4, '0')}`);
            } else if (code === 0xFEFF) {
                console.log(`  [${i}] BOM:  0xFEFF`);
            } else if (code > 0xFF00) {
                console.log(`  [${i}] SPEC: 0x${code.toString(16).padStart(4, '0')} = ${char}`);
            }
        }

        console.log('\nFirst 200 chars:');
        console.log(raw.substring(0, 200));
    }

    mobi.destroy();
    console.log('\nDone!');
}

analyze().catch(console.error);
