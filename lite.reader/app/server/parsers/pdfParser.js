/**
 * PDF 格式处理器
 * 提供 PDF 流式传输和预览功能
 */
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

/**
 * 流式传输 PDF 文件
 */
function streamPdf({ book, req, res }) {
    try {
        if (!fs.existsSync(book.filepath)) {
            console.error(`File not found: ${book.filepath}`);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }

        const stat = fs.statSync(book.filepath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(book.filepath, { start, end });

            file.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Stream error');
                }
            });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'application/pdf',
            });
            file.pipe(res);
        } else {
            const file = fs.createReadStream(book.filepath);

            file.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Stream error');
                }
            });

            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'application/pdf',
            });
            file.pipe(res);
        }
    } catch (err) {
        console.error('PDF stream error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }
    }
}

/**
 * 加载 PDF 内容（返回嵌入式查看器）
 */
function loadContent({ book, bookId }) {
    return {
        type: 'pdf',
        content: `<iframe src="/api/books/${bookId}/pdf_stream" style="width:100%;height:100%;border:none;"></iframe>`,
        title: book.title,
        format: 'pdf'
    };
}

/**
 * 获取支持的格式列表
 */
function getSupportedFormats() {
    return ['pdf'];
}

module.exports = {
    streamPdf,
    loadContent,
    getSupportedFormats
};
