/**
 * 统一 API 请求工具
 * 自动携带认证信息（Token 和 Cookie）
 */

/**
 * 发起认证请求
 * @param {string} url 请求地址
 * @param {Object} options fetch 选项
 * @returns {Promise<Response>}
 */
export async function apiRequest(url, options = {}) {
    const token = localStorage.getItem('token');

    const config = {
        ...options,
        credentials: 'include',
        cache: 'no-store', // 禁用缓存，防止 WebView 缓存旧响应或空响应
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
            ...(token && { 'Authorization': `Bearer ${token}` })
        }
    };

    return fetch(url, config);
}

/**
 * 发起 GET 请求
 */
export async function apiGet(url, options = {}) {
    return apiRequest(url, { ...options, method: 'GET' });
}

/**
 * 发起 POST 请求
 */
export async function apiPost(url, data, options = {}) {
    return apiRequest(url, {
        ...options,
        method: 'POST',
        body: JSON.stringify(data)
    });
}

/**
 * 发起 PUT 请求
 */
export async function apiPut(url, data, options = {}) {
    return apiRequest(url, {
        ...options,
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

/**
 * 发起 DELETE 请求
 */
export async function apiDelete(url, options = {}) {
    return apiRequest(url, { ...options, method: 'DELETE' });
}

export default apiRequest;
