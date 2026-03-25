/**
 * 统一 API 请求工具
 * 认证通过 httpOnly Cookie 自动携带（credentials: 'include'）
 */

/**
 * 发起认证请求
 * @param {string} url 请求地址
 * @param {Object} options fetch 选项
 * @returns {Promise<Response>}
 */
export async function apiRequest(url, options = {}) {
    const config = {
        ...options,
        credentials: 'include',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
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
