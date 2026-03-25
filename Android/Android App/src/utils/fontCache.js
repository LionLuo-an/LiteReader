import { apiGet, apiPost } from './api';
import { getAbsoluteUrl } from './patchFetch';

/**
 * 字体缓存服务
 * 使用 IndexedDB 缓存自定义字体，实现本地优先、懒加载按需下载
 * 
 * 优化：新设备不再阻塞下载所有字体，只获取列表+按需下载选中的字体
 */

const DB_NAME = 'LightReaderFontCache';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

/**
 * 派发字体同步状态事件
 * @param {string} status - 'idle' | 'syncing' | 'done' | 'error'
 * @param {object} detail - { current, total, fontName, message }
 */
function dispatchSyncStatus(status, detail = {}) {
    window.dispatchEvent(new CustomEvent('font-sync-status', {
        detail: { status, ...detail }
    }));
}

/**
 * 打开 IndexedDB 数据库
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'name' });
            }
        };
    });
}

/**
 * 从本地缓存获取所有字体
 */
export async function getCachedFonts() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result || []);
        });
    } catch (err) {
        console.error('Failed to get cached fonts:', err);
        return [];
    }
}

/**
 * 保存字体到本地缓存
 */
export async function cacheFont(name, data) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ name, data, cachedAt: Date.now() });

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(true);
        });
    } catch (err) {
        console.error('Failed to cache font:', err);
        return false;
    }
}

/**
 * 从缓存删除字体
 */
export async function removeCachedFont(name) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(name);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(true);
        });
    } catch (err) {
        console.error('Failed to remove cached font:', err);
        return false;
    }
}

/**
 * 将 Base64 字符串转换为 ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * 注册字体到浏览器
 */
export async function registerFont(name, data) {
    try {
        // 检查数据是否有效
        if (!data) {
            console.error(`Font data is empty for: ${name}`);
            return false;
        }

        let arrayBuffer;
        if (typeof data === 'string') {
            // Base64 字符串 → ArrayBuffer
            arrayBuffer = base64ToArrayBuffer(data);
        } else if (data instanceof ArrayBuffer) {
            arrayBuffer = data;
        } else if (ArrayBuffer.isView(data)) {
            arrayBuffer = data.buffer;
        } else {
            console.error(`Invalid font data type for: ${name}`, typeof data);
            return false;
        }

        const fontFace = new FontFace(name, arrayBuffer);
        await fontFace.load();
        document.fonts.add(fontFace);
        return true;
    } catch (err) {
        console.error(`Failed to register font: ${name}`, err);
        return false;
    }
}

/**
 * 获取服务器端字体列表（仅元数据，不下载实际字体文件）
 * @returns {Promise<Array<{name: string, url: string}>>}
 */
export async function getServerFontList() {
    try {
        const res = await apiGet('/api/preferences/fonts');

        if (!res.ok) {
            console.error('Fonts API error:', res.status);
            return [];
        }

        const serverFonts = await res.json();

        if (serverFonts && serverFonts.error) {
            console.error('Server returned error:', serverFonts.error);
            return [];
        }

        if (!Array.isArray(serverFonts)) {
            console.error('Server fonts is not an array:', serverFonts);
            return [];
        }

        return serverFonts;
    } catch (err) {
        console.error('Failed to get server font list:', err);
        return [];
    }
}

/**
 * 按需下载单个字体（懒加载核心函数）
 * @param {string} fontName - 字体名称
 * @param {string} fontUrl - 字体下载 URL（可选，如果不提供会从服务器列表查找）
 * @returns {Promise<boolean>} 是否成功下载并注册
 */
export async function downloadFontOnDemand(fontName, fontUrl = null) {
    const token = localStorage.getItem('token');
    // if (!token) return false; // api.js handles token, but here we use XHR manually so we need it. 
    // Actually we should check token exists if auth is required, but maybe public fonts don't need it? 
    // But previous code checked it. Let's keep it if we use XHR manually.
    if (!token) return false;

    // 先检查是否已在本地缓存
    const cachedFonts = await getCachedFonts();
    const cached = cachedFonts.find(f => f.name === fontName);
    if (cached && cached.data) {
        // 已有缓存，直接注册
        const success = await registerFont(fontName, cached.data);
        if (success) {
            console.log(`Font loaded from cache: ${fontName}`);
            return true;
        }
    }

    // 如果没有提供 URL，从服务器列表获取
    if (!fontUrl) {
        const serverFonts = await getServerFontList();
        const fontInfo = serverFonts.find(f => f.name === fontName);
        if (!fontInfo) {
            console.error(`Font not found on server: ${fontName}`);
            return false;
        }
        fontUrl = fontInfo.url;
    }

    // Convert to absolute URL
    const absoluteUrl = getAbsoluteUrl(fontUrl);
    console.log(`Downloading font from: ${absoluteUrl}`);

    return new Promise((resolve, reject) => {
        dispatchSyncStatus('syncing', {
            current: 0,
            total: 100,
            fontName: fontName,
            message: `准备下载: ${fontName}...`
        });

        const xhr = new XMLHttpRequest();
        xhr.open('GET', absoluteUrl);
        xhr.responseType = 'arraybuffer';
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.timeout = 60000; // 60s timeout

        xhr.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                dispatchSyncStatus('syncing', {
                    current: percent,
                    total: 100,
                    fontName: fontName,
                    message: `正在下载: ${fontName} (${percent}%)`
                });
            } else {
                // Fallback for missing Content-Length
                // Simulate progress or just show downloaded size
                const sizeStr = (event.loaded / 1024 / 1024).toFixed(2);
                dispatchSyncStatus('syncing', {
                    current: 50, // Fake 50% for indeterminate
                    total: 100,
                    fontName: fontName,
                    message: `正在下载: ${fontName} (${sizeStr} MB)`
                });
            }
        };

        xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const arrayBuffer = xhr.response;

                    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                        throw new Error('Empty response');
                    }

                    // 转换为 Base64 用于缓存
                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = '';
                    const chunkSize = 8192;
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        const chunk = bytes.subarray(i, i + chunkSize);
                        binary += String.fromCharCode.apply(null, chunk);
                    }
                    const base64Data = btoa(binary);

                    await cacheFont(fontName, base64Data);
                    await registerFont(fontName, arrayBuffer);

                    dispatchSyncStatus('done', {
                        current: 100,
                        total: 100,
                        message: `下载完成: ${fontName}`
                    });
                    console.log(`Font downloaded: ${fontName}`);
                    resolve(true);
                } catch (err) {
                    console.error('Font processing error:', err);
                    dispatchSyncStatus('error', { message: `所选字体文件无效` }); // User friendly
                    resolve(false);
                }
            } else {
                console.error(`Download failed: ${xhr.status}`);
                dispatchSyncStatus('error', { message: `下载失败: HTTP ${xhr.status}` });
                resolve(false);
            }
        };

        xhr.onerror = () => {
            console.error('Network error during font download');
            dispatchSyncStatus('error', { message: `网络连接失败，请检查服务器` });
            resolve(false);
        };

        xhr.ontimeout = () => {
            dispatchSyncStatus('error', { message: `下载超时，请重试` });
            resolve(false);
        };

        xhr.send();
    });
}

/**
 * 预加载字体（懒加载模式）
 * - 只加载本地已缓存的字体
 * - 获取服务器字体列表（用于显示可选字体）
 * - 如果当前选中的字体不在本地，按需下载
 * 
 * @param {string} currentFontFamily - 当前选中的字体名称（用于按需下载）
 * @returns {Promise<{loaded: string[], serverList: Array<{name: string, url: string}>}>}
 */
export async function preloadFonts(currentFontFamily = null) {
    const token = localStorage.getItem('token');
    if (!token) return { loaded: [], serverList: [] };

    const loadedFonts = [];
    let serverList = [];

    // 1. 加载本地缓存的字体（快速，不阻塞）
    try {
        const cachedFonts = await getCachedFonts();
        for (const font of cachedFonts) {
            if (!font.data) {
                console.warn(`Font cache corrupted (no data): ${font.name}`);
                await removeCachedFont(font.name);
                continue;
            }
            if (await registerFont(font.name, font.data)) {
                loadedFonts.push(font.name);
            }
        }
        console.log(`Loaded ${loadedFonts.length} fonts from local cache`);
    } catch (err) {
        console.error('Failed to load cached fonts:', err);
    }

    // 2. 获取服务器字体列表（只是元数据，不下载实际文件）
    try {
        serverList = await getServerFontList();
        console.log(`Server has ${serverList.length} fonts available`);
    } catch (err) {
        console.error('Failed to get server font list:', err);
    }

    // 3. 如果当前选中的是自定义字体且不在本地缓存中，按需下载
    if (currentFontFamily &&
        currentFontFamily !== 'sans' &&
        currentFontFamily !== 'serif' &&
        currentFontFamily !== 'default' &&
        !loadedFonts.includes(currentFontFamily)) {

        const serverFont = serverList.find(f => f.name === currentFontFamily);
        if (serverFont) {
            console.log(`Current font "${currentFontFamily}" not in cache, downloading...`);
            const success = await downloadFontOnDemand(currentFontFamily, serverFont.url);
            if (success) {
                loadedFonts.push(currentFontFamily);
            }
        }
    }

    // 4. 后台静默同步：上传本地有但服务器没有的字体
    setTimeout(async () => {
        await uploadMissingFontsToServer(token, loadedFonts, serverList);
    }, 1000);

    return { loaded: loadedFonts, serverList };
}

/**
 * 上传本地有但服务器没有的字体到服务器（后台静默执行）
 */
async function uploadMissingFontsToServer(token, localFontNames, serverList) {
    try {
        const serverNames = new Set(serverList.map(f => f.name));
        const cachedFonts = await getCachedFonts();

        for (const font of cachedFonts) {
            if (!serverNames.has(font.name) && font.data) {
                try {
                    const uploadRes = await apiPost('/api/preferences/fonts', { name: font.name, data: font.data });
                    const uploadResult = await uploadRes.json();
                    if (uploadRes.ok && uploadResult.success) {
                        console.log(`Uploaded to server: ${font.name}`);
                    }
                } catch (e) {
                    console.error(`Failed to upload font ${font.name}:`, e);
                }
            }
        }
    } catch (err) {
        console.error('Upload missing fonts failed:', err);
    }
}

/**
 * 获取当前已加载的自定义字体名称列表
 */
export async function getLoadedCustomFontNames() {
    const cachedFonts = await getCachedFonts();
    return cachedFonts.map(f => f.name);
}

/**
 * 获取完整的字体列表（本地已缓存 + 服务器可下载）
 * @returns {Promise<{cached: string[], available: string[]}>}
 */
export async function getFullFontList() {
    const cachedFonts = await getCachedFonts();
    const cachedNames = cachedFonts.map(f => f.name);

    const serverList = await getServerFontList();
    const serverNames = serverList.map(f => f.name);

    // available = 服务器有但本地没有的
    const available = serverNames.filter(name => !cachedNames.includes(name));

    return { cached: cachedNames, available };
}
