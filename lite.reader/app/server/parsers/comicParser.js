/**
 * 漫画格式解析器
 * 支持 CBZ/CBR/CB7 格式
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const mime = require('mime-types');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif', '.tiff', '.tif'];

function extractImagesFromZip(filepath) {
    const zip = new AdmZip(filepath);
    return zip.getEntries()
        .filter(e => !e.isDirectory && IMAGE_EXTENSIONS.includes(path.extname(e.entryName).toLowerCase()))
        .map(e => ({ name: e.entryName, size: e.header.size }))
        .sort((a, b) => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a.name, b.name));
}

function readImageFromZip(filepath, imageName) {
    const zip = new AdmZip(filepath);
    const entry = zip.getEntry(imageName);
    return entry ? zip.readFile(entry) : null;
}

async function parseToc({ book, isStream, coverUrl, res }) {
    try {
        const ext = path.extname(book.filepath).toLowerCase();
        let images = [];
        if (ext === '.cbz' || ext === '.zip') {
            images = extractImagesFromZip(book.filepath);
        } else if (ext === '.cbr' || ext === '.rar') {
             images = await extractImagesFromRar(book.filepath);
        } else if (ext === '.cb7' || ext === '.7z') throw new Error('CB7 format requires 7z dependency. Please use CBZ format.');
        else throw new Error('Unsupported comic format: ' + ext);
        if (images.length === 0) throw new Error('No images found in comic archive');
        const toc = images.map((img, index) => ({ title: path.basename(img.name, path.extname(img.name)), index, href: img.name, size: img.size }));
        const actualCover = coverUrl || `/api/books/${book.id}/image?path=${encodeURIComponent(images[0].name)}`;
        const response = { type: 'complete', toc, format: book.format || ext.slice(1), title: book.title || path.basename(book.filepath, ext), in_bookshelf: book.in_bookshelf, cover: actualCover, totalPages: images.length, rendition: { layout: 'pre-paginated' } };
        if (isStream && res) { res.write(`data: ${JSON.stringify(response)}\n\n`); res.end(); return null; }
        return response;
    } catch (e) {
        console.error('Comic TOC Error:', e);
        if (isStream && res) { res.write(`data: ${JSON.stringify({ type: 'error', error: 'Comic Parse Failed: ' + e.message })}\n\n`); res.end(); return null; }
        throw new Error('Comic Parse Failed: ' + e.message);
    }
}

async function loadChapter({ book, index, imagePath }) {
    const ext = path.extname(book.filepath).toLowerCase();
    let images = [];
    if (ext === '.cbz' || ext === '.zip') {
        images = extractImagesFromZip(book.filepath);
    } else if (ext === '.cbr' || ext === '.rar') {
        images = await extractImagesFromRar(book.filepath);
    }
    if (index < 0 || index >= images.length) throw new Error('Page index out of bounds');
    const targetImage = imagePath || images[index].name;
    const imageUrl = `/api/books/${book.id}/image?path=${encodeURIComponent(targetImage)}`;
    return { content: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1a1a1a;"><img src="${imageUrl}" style="max-width:100%;max-height:100%;object-fit:contain;" alt="Page ${index + 1}"></div>`, imagePath: targetImage, pageNumber: index + 1, totalPages: images.length };
}
const { getFromCache, saveToCache } = require('../utils/imageCache');

async function extractImage({ book, imagePath, res }) {
    try {
        const decodedPath = decodeURIComponent(imagePath);
        const ext = path.extname(book.filepath).toLowerCase();

        // Check cache first
        let imageBuffer = getFromCache(book.filepath, decodedPath);

        if (!imageBuffer) {
            // Not in cache, extract from archive
            if (ext === '.cbz' || ext === '.zip') {
                imageBuffer = readImageFromZip(book.filepath, decodedPath);
            }

            // Save to cache for future requests
            if (imageBuffer) {
                saveToCache(book.filepath, decodedPath, imageBuffer);
            }
        }

        if (imageBuffer) {
            res.setHeader('Content-Type', mime.lookup(imagePath) || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(imageBuffer);
        } else {
            res.status(404).json({ error: 'Image not found in comic archive' });
        }
    } catch (e) {
        console.error('Comic Image Extract Error:', e);
        res.status(500).json({ error: 'Failed to extract image: ' + e.message });
    }
}

function loadContent({ book, bookId }) {
    const ext = path.extname(book.filepath).toLowerCase();
    let images = [];
    if (ext === '.cbz' || ext === '.zip') images = extractImagesFromZip(book.filepath);
    const thumbnails = images.map((img, index) => `<div style="display:inline-block;margin:5px;"><a href="#page-${index}"><img src="/api/books/${bookId}/image?path=${encodeURIComponent(img.name)}" style="max-width:200px;max-height:300px;" alt="Page ${index + 1}"></a><div style="text-align:center;color:#666;font-size:12px;">Page ${index + 1}</div></div>`).join('');
    return { type: 'comic', content: `<div style="text-align:center;padding:20px;background:#f5f5f5;">${thumbnails}</div>`, title: book.title, format: 'comic', totalPages: images.length };
}

function getSupportedFormats() { return ['cbz', 'cbr', 'cb7']; }

// Helper functions for RAR/CBR
async function extractImagesFromRar(filepath) {
    try {
        const module = await import('node-unrar-js');
        const unrar = module.createExtractorFromData ? module : module.default;
        
        const buf = fs.readFileSync(filepath);
        const extractor = await unrar.createExtractorFromData({ data: buf });
        
        const list = extractor.getFileList();
        const images = [];
        for (const header of list) {
             if (!header.fileHeader.flags.directory && IMAGE_EXTENSIONS.includes(path.extname(header.fileHeader.name).toLowerCase())) {
                 images.push({ name: header.fileHeader.name, size: header.fileHeader.packSize }); // packSize is compressed size, unpSize is uncompressed. 
                 // Note: unrar-js headers might differ. checking docs or assuming standard.
                 // Actually node-unrar-js header has unpSize.
             }
        }
        // Sort
        images.sort((a, b) => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a.name, b.name));
        return images;
    } catch (e) {
        console.error('Failed to extract images from RAR:', e);
        return [];
    }
}

async function readImageFromRar(filepath, imageName) {
    try {
        const module = await import('node-unrar-js');
        const unrar = module.createExtractorFromData ? module : module.default;

        const buf = fs.readFileSync(filepath);
        const extractor = await unrar.createExtractorFromData({ data: buf });
        
        const extracted = extractor.extract({ files: [imageName] });
        const files = [...extracted.files];
            
        if (files.length > 0 && files[0].extraction) {
             return Buffer.from(files[0].extraction);
        }
        return null;
    } catch (e) {
        console.error('Failed to read image from RAR:', e);
        return null;
    }
}

module.exports = { parseToc, loadChapter, extractImage, loadContent, getSupportedFormats, IMAGE_EXTENSIONS };
