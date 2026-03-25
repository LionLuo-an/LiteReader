/**
 * 编码检测与转换工具
 */
const fs = require('fs');
const iconv = require('iconv-lite');
const jschardet = require('jschardet');

/**
 * 检测文件编码
 * @param {string} filepath 文件路径
 * @param {number} sampleSize 采样大小（字节），默认 4096
 * @returns {string} 检测到的编码名称
 */
function detectEncoding(filepath, sampleSize = 4096) {
    let encoding = 'utf-8';

    try {
        const buffer = Buffer.alloc(sampleSize);
        const fd = fs.openSync(filepath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, sampleSize, 0);
        fs.closeSync(fd);

        // 截取实际读取的字节
        const actualBuffer = buffer.slice(0, bytesRead);
        const detected = jschardet.detect(actualBuffer);

        if (detected && detected.encoding) {
            encoding = detected.encoding;

            // 常见误检编码映射表（Windows ANSI 通常是 GBK/GB2312）
            const encodingMap = {
                'ascii': 'utf-8',
                'windows-1252': 'gbk',
                'ISO-8859-1': 'gbk',
                'ISO-8859-2': 'gbk',
                'TIS-620': 'gbk',
                'KOI8-R': 'gbk',
            };

            // 检查是否有高字节（>127），表示非纯 ASCII
            const hasHighBytes = actualBuffer.some(b => b > 127);

            // 低置信度 + 有高字节 + 误检编码 => 修正为 GBK
            if (hasHighBytes && detected.confidence < 0.7 && encodingMap[encoding]) {
                console.log(`Encoding correction: ${encoding} (conf: ${detected.confidence}) -> gbk`);
                encoding = 'gbk';
            }
            // 高置信度但仍是误检编码（如纯西文被检测为 windows-1252）
            else if (hasHighBytes && encodingMap[encoding] && encoding !== 'ascii') {
                console.log(`Encoding mapping: ${encoding} -> gbk`);
                encoding = 'gbk';
            }
        }
    } catch (e) {
        console.error('Encoding detection failed:', e);
    }

    // 确保 iconv-lite 支持该编码
    if (!iconv.encodingExists(encoding)) {
        console.warn(`Encoding ${encoding} not supported, falling back to utf-8`);
        encoding = 'utf-8';
    }

    return encoding;
}

/**
 * 读取文件并转换编码为 UTF-8
 * @param {string} filepath 文件路径
 * @returns {{ content: string, encoding: string }} 文件内容和检测到的编码
 */
function readFileWithEncoding(filepath) {
    const buffer = fs.readFileSync(filepath);
    const detection = jschardet.detect(buffer);
    const encoding = detection.encoding || 'utf-8';
    const content = iconv.decode(buffer, encoding);

    return { content, encoding };
}

/**
 * 创建带编码转换的文件流
 * @param {string} filepath 文件路径
 * @param {string} encoding 源文件编码
 * @returns {Stream} 转换为 UTF-8 的可读流
 */
function createDecodingStream(filepath, encoding = 'utf-8') {
    const rawStream = fs.createReadStream(filepath);
    const decodedStream = rawStream.pipe(iconv.decodeStream(encoding));
    
    // 转发底层文件流错误到解码流，防止 Uncaught Exception
    rawStream.on('error', (err) => {
        decodedStream.emit('error', err);
    });

    return decodedStream;
}

module.exports = {
    detectEncoding,
    readFileWithEncoding,
    createDecodingStream
};
