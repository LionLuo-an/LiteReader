/**
 * 封面图自动提取工具
 * 支持 EPUB 和 MOBI/AZW3 格式
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { logger } = require('./logger');

// Ensure IMAGES_DIR is absolute and matches server.js
// server.js: const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
// coverExtractor.js is in utils/, so __dirname is .../app/server/utils
// To match .../app/server/images, we need ../images
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, '..', 'images');

// 确保图片目录存在
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * 从 EPUB 文件中提取封面
 * @param {string} filepath EPUB 文件路径
 * @param {number} bookId 书籍 ID
 * @returns {Promise<string|null>} 封面路径或 null
 */
async function extractEpubCover(filepath, bookId) {
    try {
        const fileBuffer = await fs.promises.readFile(filepath);
        const zip = new AdmZip(fileBuffer);
        const entries = zip.getEntries();

        let coverPath = null;
        const resolveEpubPath = (baseDir, target) => {
            if (!target) return null;
            if (/^(data:|https?:|file:)/i.test(target)) return null;
            const cleanTarget = target.replace(/^[#]/, '').replace(/^\.\//, '');
            const combined = baseDir && baseDir !== '.' ? `${baseDir}/${cleanTarget}` : cleanTarget;
            return path.posix.normalize(combined);
        };
        const normalizeEntryPath = (value) => {
            if (!value) return '';
            return path.posix.normalize(value).replace(/^\/+/, '');
        };
        const findEntryByPath = (target) => {
            if (!target) return null;
            const normalized = normalizeEntryPath(target);
            let entry = entries.find(e => normalizeEntryPath(e.entryName) === normalized);
            if (entry) return entry;
            const lower = normalized.toLowerCase();
            entry = entries.find(e => normalizeEntryPath(e.entryName).toLowerCase() === lower);
            if (entry) return entry;
            const base = path.posix.basename(normalized).toLowerCase();
            return entries.find(e => path.posix.basename(e.entryName).toLowerCase() === base) || null;
        };
        const findFirstImageInXhtml = (xhtmlPath) => {
            const xhtmlEntry = findEntryByPath(xhtmlPath);
            if (!xhtmlEntry) return null;
            const xhtmlContent = zip.readAsText(xhtmlEntry);
            const imgRegex = /<(img|image)\b[^>]*(?:src|xlink:href|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
            let imgMatch;
            while ((imgMatch = imgRegex.exec(xhtmlContent))) {
                const imgSrc = imgMatch[2];
                if (/^(data:|https?:|file:)/i.test(imgSrc)) continue;
                const xhtmlDir = path.posix.dirname(xhtmlPath);
                const resolved = resolveEpubPath(xhtmlDir, imgSrc);
                if (resolved) return resolved;
            }
            return null;
        };

        const containerEntry = entries.find(e => e.entryName === 'META-INF/container.xml');
        if (containerEntry) {
            const containerXml = zip.readAsText(containerEntry);
            const opfMatch = containerXml.match(/full-path="([^"]+)"/);

            if (opfMatch) {
                const opfPath = opfMatch[1];
                const opfEntry = entries.find(e => e.entryName === opfPath);

                if (opfEntry) {
                    const opfContent = zip.readAsText(opfEntry);
                    const opfDir = path.dirname(opfPath).replace(/\\/g, '/');

                    const manifestMap = new Map();
                    const manifestItems = [];
                    const manifestSectionMatch = opfContent.match(/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i);
                    const manifestContent = manifestSectionMatch ? manifestSectionMatch[1] : opfContent;
                    const itemTagRegex = /<item\b[^>]*>/gi;
                    let itemTagMatch;
                    while ((itemTagMatch = itemTagRegex.exec(manifestContent))) {
                        const tag = itemTagMatch[0];
                        const idMatch = tag.match(/\bid=["']([^"']+)["']/i);
                        const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
                        const propsMatch = tag.match(/\bproperties=["']([^"']+)["']/i);
                        if (idMatch && hrefMatch) {
                            manifestMap.set(idMatch[1], hrefMatch[1]);
                            manifestItems.push({ id: idMatch[1], href: hrefMatch[1], properties: propsMatch ? propsMatch[1] : '' });
                        }
                    }

                    const coverMetaMatch = opfContent.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
                        opfContent.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']cover["'][^>]*>/i);
                    const coverIdFromMeta = coverMetaMatch ? coverMetaMatch[1] : null;
                    const coverItemByMeta = coverIdFromMeta
                        ? manifestItems.find(item => item.id && item.id.toLowerCase() === coverIdFromMeta.toLowerCase())
                        : null;
                    const coverItemByProperties = manifestItems.find(item =>
                        item.properties && item.properties.toLowerCase().split(/\s+/).includes('cover-image')
                    );
                    const coverItemById = manifestItems.find(item => item.id && item.id.toLowerCase() === 'cover');
                    const explicitCoverItem = coverItemByMeta || coverItemByProperties || coverItemById;

                    if (explicitCoverItem?.href) {
                        const resolved = resolveEpubPath(opfDir, explicitCoverItem.href);
                        if (resolved && /\.(xhtml|html|htm)$/i.test(explicitCoverItem.href)) {
                            coverPath = findFirstImageInXhtml(resolved) || resolved;
                        } else {
                            coverPath = resolved;
                        }
                    }

                    if (!coverPath) {
                        const guideCoverMatch = opfContent.match(/<reference\b[^>]*type=["']cover["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
                            opfContent.match(/<reference\b[^>]*href=["']([^"']+)["'][^>]*type=["']cover["'][^>]*>/i);
                        if (guideCoverMatch) {
                            const guideHref = resolveEpubPath(opfDir, guideCoverMatch[1]);
                            coverPath = findFirstImageInXhtml(guideHref) || guideHref;
                        }
                    }

                    if (!coverPath) {
                        for (const item of manifestItems) {
                            if (!item.href || !/\.(xhtml|html|htm)$/i.test(item.href)) continue;
                            const xhtmlPath = resolveEpubPath(opfDir, item.href);
                            if (!xhtmlPath) continue;
                            const xhtmlEntry = findEntryByPath(xhtmlPath);
                            if (!xhtmlEntry) continue;
                            const xhtmlContent = zip.readAsText(xhtmlEntry);
                            const calibreCoverMeta = /<meta\b[^>]*name=["']calibre:cover["'][^>]*content=["']true["'][^>]*>/i.test(xhtmlContent) ||
                                /<meta\b[^>]*content=["']true["'][^>]*name=["']calibre:cover["'][^>]*>/i.test(xhtmlContent);
                            if (!calibreCoverMeta) continue;
                            coverPath = findFirstImageInXhtml(xhtmlPath);
                            if (coverPath) break;
                        }
                    }

                    if (!coverPath) {
                        const spineRegex = /<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*>/gi;
                        let spineMatch;
                        while ((spineMatch = spineRegex.exec(opfContent))) {
                            const href = manifestMap.get(spineMatch[1]);
                            if (!href) continue;
                            const xhtmlPath = resolveEpubPath(opfDir, href);
                            if (!xhtmlPath) continue;
                            coverPath = findFirstImageInXhtml(xhtmlPath);
                            if (coverPath) break;
                        }
                    }
                }
            }
        }

        if (!coverPath) {
            const coverNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'Cover.jpg', 'Cover.jpeg', 'Cover.png'];
            for (const name of coverNames) {
                const entry = entries.find(e => e.entryName.endsWith(name));
                if (entry) {
                    coverPath = entry.entryName;
                    break;
                }
            }
        }

        if (!coverPath) {
            const imageEntry = entries.find(e =>
                /\.(jpg|jpeg|png|gif)$/i.test(e.entryName) &&
                !e.isDirectory
            );
            if (imageEntry) {
                coverPath = imageEntry.entryName;
            }
        }

        // 提取封面
        if (coverPath) {
            const entry = findEntryByPath(coverPath);

            if (entry) {
                const buffer = zip.readFile(entry);
                const ext = path.extname(coverPath) || '.jpg';
                const savePath = path.join(IMAGES_DIR, `cover_${bookId}${ext}`);

                await fs.promises.writeFile(savePath, buffer);
                logger.info(`Extracted cover for book ${bookId}: ${savePath}`);

                return `/images/cover_${bookId}${ext}`;
            }
        }

        return null;
    } catch (err) {
        logger.error(`Failed to extract EPUB cover for book ${bookId}:`, err);
        return null;
    }
}

/**
 * 从 MOBI/AZW3 文件中提取封面
 * @param {string} filepath 文件路径
 * @param {number} bookId 书籍 ID
 * @returns {Promise<string|null>} 封面路径或 null
 */
async function extractMobiCover(filepath, bookId) {
    try {
        const { initMobiFile } = await import('@lingo-reader/mobi-parser');
        const mobi = await initMobiFile(filepath);

        // 尝试获取封面
        const metadata = mobi.getMetadata ? mobi.getMetadata() : {};

        if (metadata.cover) {
            const ext = '.jpg';
            const savePath = path.join(IMAGES_DIR, `cover_${bookId}${ext}`);
            // MOBI cover 写入也改为异步

            // 如果 cover 是 buffer
            if (Buffer.isBuffer(metadata.cover)) {
                await fs.promises.writeFile(savePath, metadata.cover);
                logger.info(`Extracted MOBI cover for book ${bookId}: ${savePath}`);
                return `/images/cover_${bookId}${ext}`;
            }
        }

        return null;
    } catch (err) {
        logger.error(`Failed to extract MOBI cover for book ${bookId}:`, err);
        return null;
    }
}

/**
 * 从 CBZ/ZIP 文件中提取封面
 * @param {string} filepath 文件路径
 * @param {number} bookId 书籍 ID
 * @returns {Promise<string|null>} 封面路径或 null
 */
async function extractCbzCover(filepath, bookId) {
    try {
        const fileBuffer = await fs.promises.readFile(filepath);
        const zip = new AdmZip(fileBuffer);
        const entries = zip.getEntries();
        const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif', '.tiff', '.tif'];

        // 查找所有图片并排序
        const images = entries
            .filter(e => !e.isDirectory && IMAGE_EXTENSIONS.includes(path.extname(e.entryName).toLowerCase()))
            .sort((a, b) => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a.entryName, b.entryName));

        if (images.length > 0) {
            const firstImage = images[0];
            const ext = path.extname(firstImage.entryName).toLowerCase();
            const savePath = path.join(IMAGES_DIR, `cover_${bookId}${ext}`);

            // 提取第一张图片
            const buffer = zip.readFile(firstImage);
            await fs.promises.writeFile(savePath, buffer);
            logger.info(`Extracted CBZ cover for book ${bookId}: ${savePath}`);
            return `/images/cover_${bookId}${ext}`;
        }

        return null;
    } catch (err) {
        logger.error(`Failed to extract CBZ cover for book ${bookId}:`, err);
        return null;
    }
}

/**
 * 根据文件格式提取封面
 * @param {string} filepath 文件路径
 * @param {string} format 文件格式
 * @param {number} bookId 书籍 ID
 * @returns {Promise<string|null>} 封面路径或 null
 */
async function extractCover(filepath, format, bookId) {
    if (!fs.existsSync(filepath)) {
        return null;
    }

    switch (format.toLowerCase()) {
        case 'epub':
            return await extractEpubCover(filepath, bookId);
        case 'mobi':
        case 'azw3':
            return await extractMobiCover(filepath, bookId);
        case 'cbz':
        case 'zip':
            return await extractCbzCover(filepath, bookId);
        case 'cbr':
        case 'rar':
            return await extractCbrCover(filepath, bookId);
        default:
            return null;
    }
}

/**
 * 从 CBR/RAR 文件中提取封面
 * @param {string} filepath 文件路径
 * @param {number} bookId 书籍 ID
 * @returns {Promise<string|null>} 封面路径或 null
 */
async function extractCbrCover(filepath, bookId) {
    try {
        // 动态引入 node-unrar-js，避免在不支持的环境中报错
        let unrar;
        try {
            const module = await import('node-unrar-js');
            unrar = module.createExtractorFromData ? module : module.default;
        } catch (e) {
            logger.warn(`node-unrar-js not installed, cannot extract CBR cover for book ${bookId}`);
            return null;
        }

        const buf = await fs.promises.readFile(filepath);
        const extractor = await unrar.createExtractorFromData({ data: buf });
        
        const list = extractor.getFileList();
        const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.jxl', '.avif', '.tiff', '.tif'];
        
        // 查找所有图片并排序
        const images = [];
        for (const header of list) {
             if (!header.fileHeader.flags.directory && IMAGE_EXTENSIONS.includes(path.extname(header.fileHeader.name).toLowerCase())) {
                 images.push(header.fileHeader.name);
             }
        }
        
        images.sort((a, b) => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a, b));

        if (images.length > 0) {
            const firstImageName = images[0];
            const ext = path.extname(firstImageName).toLowerCase();
            const savePath = path.join(IMAGES_DIR, `cover_${bookId}${ext}`);

            // 提取第一张图片
            const extracted = extractor.extract({ files: [firstImageName] });
            const files = [...extracted.files];
            
            if (files.length > 0 && files[0].extraction) {
                 await fs.promises.writeFile(savePath, files[0].extraction);
                 logger.info(`Extracted CBR cover for book ${bookId}: ${savePath}`);
                 return `/images/cover_${bookId}${ext}`;
            }
        }
        
        return null;
    } catch (err) {
        logger.error(`Failed to extract CBR cover for book ${bookId}:`, err);
        return null;
    }
}

module.exports = {
    extractCover,
    extractEpubCover,
    extractMobiCover,
    extractCbzCover,
    extractCbrCover
};
