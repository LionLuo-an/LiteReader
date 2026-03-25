/**
 * Patch global fetch to support dynamic server base URL
 * This ensures all API calls across the app use the configured server address
 */
export function patchFetch() {
    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
        let url = input;

        // Handle Request object
        if (input instanceof Request) {
            url = input.url;
        }

        const savedBase = localStorage.getItem('saved_server_url');

        // Ensure protocol exists, default to http://
        let baseUrl = savedBase;
        if (savedBase && !savedBase.match(/^https?:\/\//)) {
            baseUrl = `http://${savedBase}`;
        }

        // Logic to determine if we need to patch the URL
        let shouldPatch = false;
        let relativePath = '';

        if (typeof input === 'string') {
            if (input.startsWith('/')) {
                // Exclude local assets from patching (load from local device instead of backend)
                if (input.startsWith('/cmaps/') || 
                    input.startsWith('/standard_fonts/') || 
                    input.startsWith('/assets/')) {
                    shouldPatch = false;
                } else {
                    shouldPatch = true;
                    relativePath = input;
                }
            }
        } else if (input instanceof Request) {
            // If it's a Request object, check if it's pointing to localhost (default for relative)
            const reqUrl = new URL(input.url);
            if (reqUrl.origin === window.location.origin && reqUrl.pathname.startsWith('/api')) {
                shouldPatch = true;
                relativePath = reqUrl.pathname + reqUrl.search;
            }
        }

        // Apply patch
        if (baseUrl && shouldPatch) {
            const cleanBase = baseUrl.replace(/\/$/, '');
            const newUrl = `${cleanBase}${relativePath}`;

            if (input instanceof Request) {
                // Clone the request with the new URL
                // We must create a new Request because properties are read-only
                input = new Request(newUrl, {
                    method: input.method,
                    headers: input.headers,
                    body: input.body,
                    mode: input.mode,
                    credentials: input.credentials,
                    cache: input.cache,
                    redirect: input.redirect,
                    referrer: input.referrer,
                    integrity: input.integrity,
                });
            } else {
                input = newUrl;
            }
        }

        try {
            return await originalFetch(input, init);
        } catch (e) {
            // Enhance error message with correct URL for debugging
            const targetUrl = input instanceof Request ? input.url : input;
            console.error(`Fetch error to ${targetUrl}:`, e);
            throw new Error(`连接失败 (${targetUrl}): ${e.message}`);
        }
    };

    // Patch navigator.sendBeacon as well
    const originalSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
        let targetUrl = url;
        const savedBase = localStorage.getItem('saved_server_url');

        if (savedBase && typeof url === 'string') {
            let baseUrl = savedBase;
            if (!baseUrl.match(/^https?:\/\//)) {
                baseUrl = `http://${baseUrl}`;
            }
            const cleanBase = baseUrl.replace(/\/$/, '');

            if (url.startsWith('/')) {
                // Relative path
                targetUrl = `${cleanBase}${url}`;
            } else if (url.startsWith(window.location.origin + '/api')) {
                // Absolute path to localhost origin
                const relative = url.substring(window.location.origin.length);
                targetUrl = `${cleanBase}${relative}`;
            }
        }

        // console.log('Patched sendBeacon:', targetUrl);
        return originalSendBeacon.call(navigator, targetUrl, data);
    };

    console.log('Global fetch patched for remote server support');
}

/**
 * Helper to ensure URLs are absolute and point to the configured server
 * Useful for <img> tags which bypass fetch interception
 */
export function getAbsoluteUrl(url) {
    if (!url) return url;
    const baseUrl = localStorage.getItem('saved_server_url') || '';
    const cleanBase = baseUrl.replace(/\/$/, '');
    const baseHost = cleanBase.replace(/^https?:\/\//, '');

    if (url.startsWith('/')) {
        const prefix = cleanBase.match(/^https?:\/\//) ? cleanBase : (cleanBase ? `http://${cleanBase}` : '');
        return `${prefix}${url}`;
    }

    if (url.match(/^https?:\/\/(localhost|127\.0\.0\.1)/)) {
        return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?/, (match, protocol, host, port) => {
            return baseHost ? `http://${baseHost}` : match;
        });
    }
    return url;
}
