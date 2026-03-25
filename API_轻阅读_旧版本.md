# LightReader API 文档

**Base URL**: `/api`

本文档描述了 LightReader 后端服务提供的 API 接口。

## 认证 (Authentication)

除公共接口外，大部分 API 需要 Bearer Token 或 Cookie 认证。
登录成功后，服务器会设置 `auth_token` Cookie，同时返回 Token 供客户端使用。

### 公共接口

#### 获取应用版本
`GET /public/version`
- **响应**: `{ "version": "1.0.8" }`

#### 获取注册开关状态
`GET /public/settings`
- **响应**: `{ "registration_enabled": true }`

---

## 用户认证 (Auth)

**Prefix**: `/auth`

#### 获取注册开关状态
`GET /auth/settings`
- **响应**: `{ "registration_enabled": true }`

#### 用户注册
`POST /auth/register`
- **Body**: `{ "username": "user", "password": "pwd" }`
- **响应**: `{ "id": 1 }`

#### 用户登录
`POST /auth/login`
- **Body**: `{ "username": "user", "password": "pwd" }`
- **响应**: `{ "token": "jwt_token...", "user": { ... } }`
- **Cookie**: 设置 `auth_token`

#### 验证 Token / 获取当前用户
`GET /auth/verify`
- **Headers**: `Authorization: Bearer <token>`
- **响应**: `{ "token": "new_token...", "user": { ... } }`

#### 修改密码
`POST /auth/change-password`
- **Body**: `{ "oldPassword": "...", "newPassword": "..." }`

#### 更新个人资料
`PUT /auth/profile`
- **Body**: `{ "nickname": "...", "oldPassword": "...", "newPassword": "..." }`

#### 更新个人资料（兼容旧 API）
`PUT /user/profile`
- **Body**: `{ "nickname": "...", "oldPassword": "...", "newPassword": "..." }`

#### 登出
`POST /auth/logout`
- **响应**: 清除 Cookie

---

## 书籍管理 (Books)

**Prefix**: `/books`

#### 获取书籍列表
`GET /books`
- **说明**: 获取当前用户可见的所有书籍（包括私有、公共书库、公共书籍）。
- **响应**: `[ { "id": 1, "title": "Book Title", "cover": "...", ... }, ... ]`

#### 上传书籍
`POST /books`
- **Content-Type**: `multipart/form-data`
- **Body**: `file` (文件), `folder_id` (可选)
- **响应**: `{ "id": 1, "title": "filename" }`

#### 删除书籍
`DELETE /books/:id`
- **说明**: 删除书籍及其相关数据（进度、书签等）。

#### 重命名书籍
`PUT /books/:id/rename`
- **Body**: `{ "title": "New Title" }`

#### 批量移动书籍
`PUT /books/move`
- **Body**: `{ "bookIds": [1, 2], "folderId": 1 }` (folderId 为 null 代表移出文件夹)

#### 切换书籍公开状态（仅管理员）
`PUT /books/:id/public`
- **Body**: `{ "is_public": true }`

#### 更新书籍封面
`POST /books/:id/cover`
- **Content-Type**: `multipart/form-data`
- **Body**: `cover` (图片文件)
- **响应**: `{ "cover": "/images/covers/xxx.jpg" }`

#### 获取书籍默认封面
`GET /books/:id/cover/default`
- **响应**: `{ "cover": "/images/cover_xxx.jpg" | null }`

#### 删除书籍封面
`DELETE /books/:id/cover`
- **响应**: `{ "cover": "/images/cover_xxx.jpg" | null }` (恢复为默认封面)

---

## 阅读器功能 (Reader)

**Prefix**: `/books` (与书籍管理共用前缀)

#### 获取书籍目录 (TOC)
`GET /books/:id/toc`
- **响应**: 目录树结构

#### 获取章节内容
`GET /books/:id/chapter/:index`
- **Query**:
    - `start`, `end`: (TXT) 行号范围
    - `href`: (EPUB) 章节链接
- **响应**: 章节内容或文本

#### 获取图片资源
`GET /books/:id/image`
- **Query**: `path` (图片在书籍压缩包内的路径)
- **响应**: 图片文件流

#### PDF 流式传输
`GET /books/:id/pdf_stream`
- **说明**: 支持 Range 请求的 PDF 流

#### 获取书籍全文内容
`GET /books/:id/content`
- **响应**: `{ "type": "text", "content": "...", "title": "..." }` 或 `format: "pdf_preview"`

#### 获取阅读进度
`GET /books/:id/progress`
- **响应**: `{ "progress_percent": 0.5, "chapter_index": 1, ... }`

#### 保存阅读进度
`POST /books/:id/progress`
- **Body**: `{ "scroll_top": 0, "chapter_index": 1, "chapter_title": "...", "progress_percent": 0.5, "chapter_percent": 0.1, "anchor_text": "...", "device_id": "...", "force": false, "token": "..." }`

#### 添加书签
`POST /books/:id/bookmarks`
- **Body**: `{ "chapter_index": 1, "chapter_title": "...", "scroll_top": 0, "text_preview": "...", "chapter_percent": 0.1, "anchor_text": "..." }`

#### 获取书签
`GET /books/:id/bookmarks`

#### 删除书签
`DELETE /books/bookmarks/:id`

#### 删除书签（兼容旧 API）
`DELETE /bookmarks/:id`

---

## 书架与文件夹 (Bookshelf)

**Prefix**: `/books/bookshelf`

#### 获取书架文件夹
`GET /books/bookshelf/folders`

#### 创建书架文件夹
`POST /books/bookshelf/folders`
- **Body**: `{ "name": "Folder Name" }`

#### 重命名书架文件夹
`PUT /books/bookshelf/folders/:id/rename`
- **Body**: `{ "name": "New Name" }`

#### 删除书架文件夹
`DELETE /books/bookshelf/folders/:id`

#### 移动书籍到书架文件夹
`PUT /books/bookshelf/move`
- **Body**: `{ "bookIds": [...], "folderId": 1 }`

#### 添加书籍到书架
`POST /books/bookshelf/:bookId`

#### 从书架移除书籍
`DELETE /books/bookshelf/:bookId`

#### 批量从书架移除
`DELETE /books/bookshelf/batch`
- **Body**: `{ "bookIds": [...] }`

#### 批量添加到书架
`PUT /books/bookshelf/batch`
- **Body**: `{ "bookIds": [...], "folderId": ... }`

---

## 文件夹 (Folders)

**Prefix**: `/books`

#### 获取文件夹列表
`GET /books/folders`

#### 创建文件夹
`POST /books/folders`
- **Body**: `{ "name": "Folder Name" }`

#### 删除文件夹
`DELETE /books/folders/:id`

#### 重命名文件夹
`PUT /books/folders/:id/rename`
- **Body**: `{ "name": "New Name" }`

---

## 搜索 (Search)

**Prefix**: `/search`

#### 搜索书籍
`GET /search`
- **Query**: `q` (关键词), `type` (默认 title), `limit`, `offset`
- **响应**: `{ "results": [...], "total": 10 }`

#### 搜索建议
`GET /search/suggest`
- **Query**: `q`
- **响应**: `["suggestion1", "suggestion2"]`

---

## 统计 (Stats)

**Prefix**: `/stats`

#### 获取统计概览
`GET /stats/overview`
- **响应**: `{ "books_read": 10, "total_reading_time": { ... }, ... }`

#### 获取每日阅读统计
`GET /stats/daily`
- **Query**: `days` (默认30天)

#### 获取书籍阅读排行
`GET /stats/books`

#### 记录阅读时长
`POST /stats/record`
- **Body**: `{ "book_id": 1, "duration_seconds": 60, "theme": "light" }`
- **响应**: 返回本次记录结果及新解锁的成就

---

## 偏好设置 (Preferences)

**Prefix**: `/preferences`

#### 获取所有偏好
`GET /preferences`

#### 获取单个偏好
`GET /preferences/:key`

#### 设置单个偏好
`PUT /preferences/:key`
- **Body**: `{ "value": ... }`

#### 批量设置偏好
`POST /preferences/batch`
- **Body**: `{ "preferences": { "key1": "val1", ... } }`

#### 删除单个偏好
`DELETE /preferences/:key`

#### 获取阅读器设置
`GET /preferences/reader/settings`
- **响应**: `{ "theme": "light", "fontSize": 18, ... }`

#### 保存阅读器设置
`PUT /preferences/reader/settings`

#### 获取设备特定阅读设置
`GET /preferences/reader/settings/:deviceType`
- **Param**: `deviceType` (`mobile` 或 `desktop`)

#### 保存设备特定阅读设置
`PUT /preferences/reader/settings/:deviceType`

#### 自定义字体列表
`GET /preferences/fonts`

#### 获取字体文件
`GET /preferences/fonts/:fontName/file`

#### 上传字体
`POST /preferences/fonts`
- **Body**: `{ "name": "MyFont", "data": "Base64..." }`

#### 删除字体
`DELETE /preferences/fonts/:fontName`

---

## 成就系统 (Achievements)

**Prefix**: `/achievements`

#### 获取成就配置（管理员）
`GET /achievements/config`

#### 创建成就配置（管理员）
`POST /achievements/config`

#### 删除成就配置（管理员）
`DELETE /achievements/config/:id`

#### 获取我的成就
`GET /achievements/my`

#### 佩戴成就徽章
`POST /achievements/:id/equip`

#### 卸下成就徽章
`POST /achievements/unequip`

---

## 管理员功能 (Admin)

**Prefix**: `/admin` (需管理员权限)

#### 获取系统设置
`GET /admin/settings`

#### 更新系统设置
`PUT /admin/settings`
- **Body**: `{ "key": "registration_enabled", "value": "true" }`

#### 用户管理
- `GET /admin/users`: 用户列表
- `PUT /admin/users/:id/password`: 重置密码
- `DELETE /admin/users/:id`: 删除用户

#### 书库管理 (Libraries)
- `GET /admin/libraries`: 获取书库列表
- `POST /admin/libraries`: 添加本地书库 (`{ "name": "Lib", "path": "C:/Books" }`)
- `DELETE /admin/libraries/:id`: 删除书库
- `POST /admin/libraries/:id/scan`: 重新扫描
- `GET /admin/libraries/:id/scan-status`: 获取扫描状态
- `PUT /admin/libraries/:id/rename`: 重命名
- `PUT /admin/libraries/:id/public`: 切换公开状态

#### 用户权限
- `GET /admin/users/:id/library-permissions`: 获取用户权限
- `PUT /admin/users/:id/library-permissions`: 设置用户权限

---

## 笔记 (Notes)

**Prefix**: `/notes`

#### 获取书籍笔记
`GET /notes/:bookId`

#### 创建笔记
`POST /notes`
- **Body**: `{ "bookId": 1, "chapterIndex": 1, "textContent": "...", "noteContent": "...", "style": "highlight", "color": "#ff0", "contextPre": "...", "contextPost": "...", "rangeStart": 0 }`

#### 更新笔记
`PUT /notes/:id`
- **Body**: `{ "noteContent": "...", "style": "...", "color": "..."}`

#### 删除笔记
`DELETE /notes/:id`

