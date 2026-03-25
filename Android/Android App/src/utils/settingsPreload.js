/**
 * 阅读设置预加载服务
 * 在应用启动时预加载用户设置，缓存到 localStorage
 */

/**
 * 检测设备类型
 */
export function getDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod|android|mobile/.test(ua) ? 'mobile' : 'desktop';
}

/**
 * 获取默认设置
 */
export function getDefaultSettings(deviceType) {
    return {
        theme: 'light',
        fontSize: deviceType === 'mobile' ? 18 : 20,
        lineHeight: 2.0,
        fontFamily: 'sans',
        marginH: deviceType === 'mobile' ? 20 : 40,
        marginV: deviceType === 'mobile' ? 40 : 60,
        textAlign: 'justify',
        viewMode: 'scroll'
    };
}

/**
 * 从 localStorage 获取缓存的设置
 */
export function getCachedSettings() {
    return {
        fontSize: parseInt(localStorage.getItem('reader_fontSize')) || null,
        lineHeight: parseFloat(localStorage.getItem('reader_lineHeight')) || null,
        marginH: parseInt(localStorage.getItem('reader_marginH')) || null,
        marginV: parseInt(localStorage.getItem('reader_marginV')) || null,
        theme: localStorage.getItem('reader_theme') || null,
        fontFamily: localStorage.getItem('reader_fontFamily') || null,
        textAlign: localStorage.getItem('reader_textAlign') || null,
        viewMode: localStorage.getItem('reader_viewMode') || null
    };
}

/**
 * 保存设置到 localStorage
 */
export function cacheSettings(settings) {
    if (settings.fontSize) localStorage.setItem('reader_fontSize', settings.fontSize);
    if (settings.lineHeight) localStorage.setItem('reader_lineHeight', settings.lineHeight);
    if (settings.marginH) localStorage.setItem('reader_marginH', settings.marginH);
    if (settings.marginV) localStorage.setItem('reader_marginV', settings.marginV);
    if (settings.theme) localStorage.setItem('reader_theme', settings.theme);
    if (settings.fontFamily) localStorage.setItem('reader_fontFamily', settings.fontFamily);
    if (settings.textAlign) localStorage.setItem('reader_textAlign', settings.textAlign);
    if (settings.viewMode) localStorage.setItem('reader_viewMode', settings.viewMode);
}

/**
 * 预加载阅读设置（后台静默同步）
 * 不阻塞主流程
 */
export async function preloadSettings() {
    const token = localStorage.getItem('token');
    if (!token) return null;

    const deviceType = getDeviceType();

    // 后台静默从服务器同步设置
    setTimeout(async () => {
        try {
            const res = await fetch(`/api/preferences/reader/settings/${deviceType}`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include'
            });

            if (res.ok) {
                const serverSettings = await res.json();
                cacheSettings(serverSettings);
                console.log('Settings synced from server');
            }
        } catch (err) {
            console.error('Background settings sync failed:', err);
        }
    }, 50);

    return getCachedSettings();
}
