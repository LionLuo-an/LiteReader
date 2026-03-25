/**
 * EPUB 格式解析器
 * 支持 EPUB2(NCX) 和 EPUB3(Nav) 格式
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const mime = require('mime-types');
const { normalizeWhitespace, getElementText, parseXML, resolveURL, pathDirname, NS, MIME } = require('./utils');

function parseNav(doc, resolve = f => f) {
    const resolveHref = href => href ? decodeURI(resolve(href)) : null;
    const parseLI = getType => $li => {
        const $a = $li.querySelector('a') ?? $li.querySelector('span');
        const $ol = $li.querySelector('ol');
        const href = resolveHref($a?.getAttribute('href'));
        const label = getElementText($a) || $a?.getAttribute('title');
        const subitems = $ol ? [...$ol.querySelectorAll(':scope > li')].map(parseLI(getType)) : null;
        const result = { label, href, subitems };
        if (getType) result.type = $a?.getAttribute('epub:type')?.split(/\s/);
        return result;
    };

    const $$nav = [...doc.querySelectorAll('nav')];
    let toc = null;
    for (const $nav of $$nav) {
        const type = $nav.getAttribute('epub:type')?.split(/\s/) ?? [];
        if (type.includes('toc')) {
            const $ol = $nav.querySelector('ol');
            toc = toc ?? ($ol ? [...$ol.querySelectorAll(':scope > li')].map(parseLI(false)) : null);
        }
    }
    return { toc };
}

function parseNCX(doc, resolve = f => f) {
    const resolveHref = href => href ? decodeURI(resolve(href)) : null;
    const parseItem = el => {
        const $label = el.querySelector('navLabel');
        const $content = el.querySelector('content');
        const label = getElementText($label);
        const href = resolveHref($content?.getAttribute('src'));
        const els = [...el.querySelectorAll(':scope > navPoint')];
        return { label, href, subitems: els.length ? els.map(parseItem) : null };
    };
    const $navMap = doc.querySelector('navMap');
    return { toc: $navMap ? [...$navMap.querySelectorAll(':scope > navPoint')].map(parseItem) : null };
}

class EPUBReader {
    constructor(filepath) {
        this.filepath = filepath;
        this.zip = new AdmZip(filepath);
        this.manifest = {};
        this.spine = [];
        this.metadata = {};
        this.toc = [];
        this.opfPath = '';
    }

    loadText(entryPath) { const e = this.zip.getEntry(entryPath); return e ? this.zip.readAsText(e) : null; }
    loadBlob(entryPath) { const e = this.zip.getEntry(entryPath); return e ? this.zip.readFile(e) : null; }
    loadXML(entryPath) { const str = this.loadText(entryPath); return str ? parseXML(str, 'application/xml') : null; }

    async init() {
        const container = this.loadXML('META-INF/container.xml');
        if (!container) throw new Error('Failed to load container');
        const rootfiles = container.getElementsByTagNameNS(NS.CONTAINER, 'rootfile');
        if (rootfiles.length === 0) throw new Error('No rootfile found');
        this.opfPath = rootfiles[0].getAttribute('full-path');
        const opfDir = pathDirname(this.opfPath);

        const opf = this.loadXML(this.opfPath);
        if (!opf) throw new Error('Failed to load OPF');

        const manifestEl = opf.getElementsByTagNameNS(NS.OPF, 'manifest')[0];
        if (manifestEl) {
            for (const item of manifestEl.getElementsByTagNameNS(NS.OPF, 'item')) {
                const id = item.getAttribute('id'), href = item.getAttribute('href'),
                    mediaType = item.getAttribute('media-type'),
                    properties = item.getAttribute('properties')?.split(/\s/) || [];
                this.manifest[id] = { id, href: resolveURL(href, this.opfPath), mediaType, properties };
            }
        }

        const spineEl = opf.getElementsByTagNameNS(NS.OPF, 'spine')[0];
        if (spineEl) {
            for (const itemref of spineEl.getElementsByTagNameNS(NS.OPF, 'itemref')) {
                this.spine.push({ idref: itemref.getAttribute('idref'), linear: itemref.getAttribute('linear') });
            }
        }

        const getDC = name => { const els = opf.getElementsByTagNameNS(NS.DC, name); return els.length > 0 ? getElementText(els[0]) : null; };
        this.metadata = {
            identifier: getDC('identifier'), title: getDC('title'), language: getDC('language'),
            description: getDC('description'), publisher: getDC('publisher'), published: getDC('date'), author: []
        };
        for (const c of opf.getElementsByTagNameNS(NS.DC, 'creator')) this.metadata.author.push(getElementText(c));

        await this.parseTOC(opf);
        return this;
    }

    async parseTOC(opf) {
        const navItem = Object.values(this.manifest).find(item => item.properties?.includes('nav'));
        if (navItem) {
            try {
                const navDoc = this.loadXML(navItem.href);
                if (navDoc) { const nav = parseNav(navDoc, url => resolveURL(url, navItem.href)); if (nav.toc) { this.toc = this.flattenTOC(nav.toc); return; } }
            } catch (e) { console.warn('Nav parse failed:', e); }
        }
        const spineEl = opf.getElementsByTagNameNS(NS.OPF, 'spine')[0];
        const tocId = spineEl?.getAttribute('toc');
        const ncxItem = tocId ? this.manifest[tocId] : Object.values(this.manifest).find(item => item.mediaType === MIME.NCX);
        if (ncxItem) {
            try {
                const ncxDoc = this.loadXML(ncxItem.href);
                if (ncxDoc) { const ncx = parseNCX(ncxDoc, url => resolveURL(url, ncxItem.href)); if (ncx.toc) { this.toc = this.flattenTOC(ncx.toc); return; } }
            } catch (e) { console.warn('NCX parse failed:', e); }
        }
        this.toc = this.spine.map((item, index) => ({ title: this.manifest[item.idref]?.id || `Chapter ${index + 1}`, href: this.manifest[item.idref]?.href, index }));
    }

    flattenTOC(items, level = 0) {
        const result = [];
        const flatten = (items, level) => { if (!items) return; for (const item of items) { result.push({ title: item.label || `Chapter ${result.length + 1}`, href: item.href, index: result.length, level }); if (item.subitems) flatten(item.subitems, level + 1); } };
        flatten(items, 0);
        return result;
    }
}

function injectEpubStyles(rawHtml) {
    if (!rawHtml) return rawHtml;
    if (rawHtml.includes('data-reader-style="epub"')) return rawHtml;
    const styleTag = `<style data-reader-style="epub">` +
        `a[href^="#"],a[href*="#"],a[epub\\:type="noteref"],a.noteref,sup a{color:#2563eb !important;text-decoration:underline !important;}` +
        `p{text-indent:2em !important;margin:0 0 0.8em 0 !important;}` +
        `h1,h2,h3,h4,h5,h6,.chapter-title,.title{text-indent:0 !important;}` +
        `</style>`;
    if (/<\/head>/i.test(rawHtml)) {
        return rawHtml.replace(/<\/head>/i, `${styleTag}</head>`);
    }
    if (/<body[^>]*>/i.test(rawHtml)) {
        return rawHtml.replace(/<body[^>]*>/i, match => `${match}${styleTag}`);
    }
    return `${styleTag}${rawHtml}`;
}

/**
 * 解析目录 (TOC)
 * 改进逻辑：优先遍历 Spine (阅读顺序) 来构建目录，避免 Nav/NCX 遗漏章节
 */
async function parseToc({ book, isStream, coverUrl, res }) {
    try {
        const reader = new EPUBReader(book.filepath);
        await reader.init();

        // 1. 获取基础 TOC (Nav/NCX)
        // 建立 href -> title 的映射
        const hrefToTitle = new Map();
        const flatten = (items) => {
            if (!items) return;
            for (const item of items) {
                if (item.href) {
                    // 处理 href 中的 hash (如 chapter1.html#section1)
                    // 同时存储带 hash 和不带 hash 的版本以提高匹配率
                    const bareHref = item.href.split('#')[0];
                    hrefToTitle.set(item.href, item.title);
                    hrefToTitle.set(bareHref, item.title);
                }
                if (item.subitems) flatten(item.subitems);
            }
        };
        flatten(reader.toc);

        // 2. 遍历 Spine 构建完整目录
        // Spine 是 EPUB 的标准阅读顺序，必须完整显示
        let finalToc = [];
        reader.spine.forEach((itemRef, index) => {
            if (itemRef.linear === 'no') return; // 跳过非线性内容 (可选)

            const manifestItem = reader.manifest[itemRef.idref];
            if (!manifestItem) return;

            const href = manifestItem.href;
            // 尝试从 Nav/NCX 中查找标题，否则使用兜底标题
            let title = hrefToTitle.get(href) || `Chapter ${index + 1}`;

            // 如果是第一章且没有标题，尝试推断 (如楔子、封面)
            if (index === 0 && !hrefToTitle.has(href)) {
                title = "Start";
            }

            finalToc.push({
                title: title,
                id: href,
                href: href,
                index: index,
                level: 0
            });
        });

        // 如果 Spine 构建失败 (极少见)，回退到仅使用 Nav/NCX
        if (finalToc.length === 0 && reader.toc.length > 0) {
            finalToc = reader.toc.map((item, index) => ({
                title: item.title,
                id: item.href?.split('#')[0],
                href: item.href,
                index: index,
                level: item.level || 0
            }));
        }

        // 3. 尝试提取封面
        // 用户反馈：不要强制显示封面，这可能导致 403 或覆盖正确的首图
        // 恢复原有逻辑：仅使用传入的 coverUrl (数据库/元数据)
        let foundCover = coverUrl;
        /* 移除自动探测逻辑
        if (!foundCover) {
            const coverItem = Object.values(reader.manifest).find(
                item => item.properties?.includes('cover-image') || item.id.toLowerCase().includes('cover')
            );
            if (coverItem) {
                foundCover = `/api/books/${book.id}/image?path=${encodeURIComponent(coverItem.href)}`;
            }
        }
        */

        const response = {
            type: 'complete',
            toc: finalToc,
            format: 'epub',
            title: reader.metadata.title || book.title,
            author: reader.metadata.author,
            in_bookshelf: book.in_bookshelf,
            cover: foundCover
        };

        if (isStream && res) {
            res.write(`data: ${JSON.stringify(response)}\n\n`);
            res.end();
            return null;
        }

        return response;

    } catch (e) {
        console.error('EPUB TOC Error:', e);
        const errorMsg = 'EPUB Parse Failed: ' + e.message;
        if (isStream && res) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
            res.end();
            return null;
        }
        throw new Error(errorMsg);
    }
}

async function loadChapter({ book, href, bookId, token }) {
    if (!href) throw new Error('Href required for EPUB chapter');
    const reader = new EPUBReader(book.filepath);
    await reader.init();
    let chapterHref = href.includes('#') ? href.split('#')[0] : href;
    let manifestItem = Object.values(reader.manifest).find(item => item.href === chapterHref || item.href === decodeURI(chapterHref));
    if (!manifestItem) manifestItem = Object.values(reader.manifest).find(item => item.href.endsWith(chapterHref) || item.href.endsWith(decodeURI(chapterHref)));
    if (!manifestItem) throw new Error('Chapter not found in manifest');
    let text = reader.loadText(manifestItem.href);
    if (!text) throw new Error('Failed to read chapter content');
    const currentDir = pathDirname(manifestItem.href);
    text = rewriteImagePaths(text, currentDir, bookId, token);
    text = injectEpubStyles(text);
    return { content: text };
}

function rewriteImagePaths(text, currentDir, bookId, token) {
    return text.replace(/(src|href)="([^"]+)"/g, (match, attr, val) => {
        if (val.startsWith('http') || val.startsWith('https') || val.startsWith('#') || val.startsWith('mailto:')) return match;
        let decodedVal = val; try { decodedVal = decodeURIComponent(val); } catch (e) { }
        let targetPath = decodedVal;
        if (decodedVal.startsWith('/')) { targetPath = decodedVal.substring(1); }
        else {
            const currentDirParts = currentDir === '.' ? [] : currentDir.split('/').filter(Boolean);
            const valParts = decodedVal.split('/');
            for (const p of valParts) { if (p === '..') { if (currentDirParts.length > 0) currentDirParts.pop(); } else if (p !== '.') { currentDirParts.push(p); } }
            targetPath = currentDirParts.join('/');
        }
        if (targetPath.match(/\.(jpg|jpeg|png|gif|svg|webp|bmp|tif|tiff)$/i)) {
            let url = `/api/books/${bookId}/image?path=${encodeURIComponent(targetPath)}`;
            if (token) url += `&token=${token}`;
            return `${attr}="${url}"`;
        }
        return match;
    });
}

function extractImage({ book, imagePath, res }) {
    try {
        let targetPath = decodeURIComponent(imagePath).replace(/\\/g, '/');
        if (targetPath.startsWith('/')) targetPath = targetPath.substring(1);
        const zip = new AdmZip(book.filepath);
        const entries = zip.getEntries();
        let entry = entries.find(e => e.entryName === targetPath) || entries.find(e => e.entryName.toLowerCase() === targetPath.toLowerCase()) ||
            entries.find(e => e.entryName.endsWith(targetPath.split('/').filter(p => p !== '..').join('/'))) || entries.find(e => path.basename(e.entryName) === path.basename(targetPath));
        if (entry) {
            const buffer = zip.readFile(entry);
            res.setHeader('Content-Type', mime.lookup(entry.entryName) || 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.send(buffer);
        } else { res.status(404).json({ error: 'Image not found in archive' }); }
    } catch (e) {
        // 403/Permission errors usually mean the path is outside the zip or invalid
        // User requested: "获取不到就不要显示", so we return 404 to fail gracefully
        console.warn('EPUB Image Extract Warning:', e.message);
        res.status(404).json({ error: 'Image extraction failed or denied' });
    }
}

function getSupportedFormats() { return ['epub']; }

module.exports = { parseToc, loadChapter, extractImage, rewriteImagePaths, getSupportedFormats, EPUBReader, parseNav, parseNCX };
