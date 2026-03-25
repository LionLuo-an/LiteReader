// 书库（公共/个人）
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Book, Search, ChevronRight, Folder, Plus, Check, X, Trash2, FolderPlus, Loader2, ArrowLeft, Edit2, BookPlus, CheckSquare, Square, MoreVertical } from 'lucide-react';
import FormatTag from './FormatTag';

// ... (保留中间代码不变，只展示修改部分的前后文太长了，我分块修改比较好)
// 实际上 replace_file_content 最好一次处理一个块，或者如果相隔太远就分多次。
// 这里的修改点分散在开头和中间。
// 我将分三次调用或者一次 multi_replace。
// 既然我有 multi_replace，那就用 multi_replace。
import { useIsFnOSMobile } from '../hooks/useIsFnOSMobile';
import useLongPress from '../hooks/useLongPress';
import { showToast } from './Toast';

const RepoBookItem = ({
    book, isSelectionMode, isSelected, onClick, onContextMenu,
    handleAddToBookshelf, handleRemoveFromBookshelf, onToggleSelection, onRename, onDelete,
    isFnOSMobile, colors, isDark, isEInk
}) => {
    const bind = useLongPress((e) => onContextMenu(e, book), () => onClick(book));

    return (
        <div
            {...bind}
            className={`w-full flex items-center px-4 py-3 transition-colors relative cursor-pointer group min-h-[3.5rem] ${isSelectionMode && isSelected
                ? 'bg-blue-500/10'
                : colors.itemHover
                }`}
        >
            {/* Selection Checkbox (Left) */}
            {isSelectionMode && (
                <div className="mr-3 shrink-0">
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${isSelected
                        ? 'bg-blue-500 border-blue-500'
                        : (isDark ? 'border-gray-600' : 'border-gray-300')
                        }`}>
                        {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </div>
                </div>
            )}

            {/* Content (Format Tag + Title) */}
            <div className="flex-1 flex items-center min-w-0 gap-3">
                <FormatTag format={book.format} isDark={isDark} isEInk={isEInk} />
                <span className={`text-sm font-medium truncate ${colors.textMain}`}>
                    {book.title.replace(/\.(txt|epub|mobi|azw3|pdf|md|fb2|cbz|cbr)$/i, '')}
                </span>

                {/* In Bookshelf Indicator */}
                {!isSelectionMode && book.in_bookshelf == 1 && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[9px] rounded-md bg-orange-500/10 text-orange-600 border border-orange-200">
                        已在书架
                    </span>
                )}
            </div>

            {/* Actions (Right) */}
            {!isSelectionMode ? (
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onContextMenu(e, book);
                    }}
                    className={`p-2 -mr-2 rounded-full relative z-10 transition-colors ${isDark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-400 hover:bg-gray-100'
                        }`}
                >
                    <MoreVertical className="w-4 h-4" />
                </button>
            ) : (
                <div className="w-8"></div>
            )}
        </div>
    );
};


const Repository = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get('tab') || 'public';
    const isFnOSMobile = useIsFnOSMobile();

    // Theme State
    const [theme, setTheme] = useState(localStorage.getItem('app_theme') || 'light');
    const isDark = theme === 'dark';
    const isEInk = theme === 'e-ink';

    // Optimize Theme Sync: Use event listener instead of polling
    useEffect(() => {
        const handleThemeChange = () => setTheme(localStorage.getItem('app_theme') || 'light');
        window.addEventListener('theme-change', handleThemeChange);
        window.addEventListener('storage', handleThemeChange);
        return () => {
            window.removeEventListener('theme-change', handleThemeChange);
            window.removeEventListener('storage', handleThemeChange);
        };
    }, []);

    const PAGE_SIZE = 60;
    const loadMoreRef = useRef(null);

    const [books, setBooks] = useState(() => {
        try {
            const cached = sessionStorage.getItem('repo_active_books_cache');
            return cached ? JSON.parse(cached) : [];
        } catch (e) { return []; }
    });
    const [folders, setFolders] = useState(() => {
        try {
            const cached = sessionStorage.getItem('repo_folders_cache');
            return cached ? JSON.parse(cached) : [];
        } catch (e) { return []; }
    });
    const [publicFolders, setPublicFolders] = useState([]);
    const [loading, setLoading] = useState(books.length === 0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [offset, setOffset] = useState(books.length);
    const [totalBooks, setTotalBooks] = useState(0);
    const [hasMore, setHasMore] = useState(false);

    const [user, setUser] = useState({});
    const [searchQuery, setSearchQuery] = useState('');

    // Navigation State
    const currentFolderParam = searchParams.get('folder') || '';
    const currentFolder = useMemo(() => {
        const fParam = searchParams.get('folder');
        if (!fParam) return null;
        if (activeTab === 'personal') {
            return folders.find(f => String(f.id) === fParam) || null;
        } else {
            return fParam;
        }
    }, [searchParams, activeTab, folders]);

    // Scroll to top on navigation change
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [currentFolder, activeTab]);

    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedBooks, setSelectedBooks] = useState(new Set());
    const [selectedFolders, setSelectedFolders] = useState(new Set());
    const [uploading, setUploading] = useState(false);
    const [showFolderDialog, setShowFolderDialog] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [showRenameDialog, setShowRenameDialog] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [actionMenuTarget, setActionMenuTarget] = useState(null);
    const [renameTarget, setRenameTarget] = useState(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState(null); // Reuse for Remove from Bookshelf confirmation
    const renameInputRef = useRef(null);
    const longPressTimer = useRef(null);

    // Bookshelf Folder Selection State
    const [bookshelfFolders, setBookshelfFolders] = useState([]);
    const [showBookshelfFolderDialog, setShowBookshelfFolderDialog] = useState(false);
    const [newBookshelfFolderName, setNewBookshelfFolderName] = useState('');
    const [pendingBookId, setPendingBookId] = useState(null); // For single book add

    // --- Back Button Logic to prevent App Exit ---
    useEffect(() => {
        const handlePopState = (event) => {
            // Ensure we stay in the app when navigating back from a folder
            // This listener mainly ensures we handle the state gracefully
            if (activeTab === 'personal' && searchParams.get('folder')) {
                // The router will handle the URL change, but we want to ensure
                // we don't accidentally exit if the history stack was short.
                // However, we can't easily prevent exit if the stack is empty.
                // The best we can do is ensure we PUSH state when entering.
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [activeTab, searchParams]);

    // --- State Persistence (Added) ---
    // Restore state on mount (only if no redundant navigation params)
    useEffect(() => {
        if (!searchParams.get('folder') && !searchParams.get('tab')) {
            const lastFolder = sessionStorage.getItem('repo_last_folder');
            const lastTab = sessionStorage.getItem('repo_last_tab');

            const newParams = {};
            if (lastTab) newParams.tab = lastTab;
            if (lastFolder) newParams.folder = lastFolder;

            if (Object.keys(newParams).length > 0) {
                setSearchParams(newParams, { replace: true });
            }
        }
    }, []);

    // --- History & Back Button Logic (Selection Mode) ---
    useEffect(() => {
        // When entering selection mode, push a state
        if (isSelectionMode) {
            // Push state only if we didn't just come from a popstate event (this is tricky to detect perfectly, 
            // but we can assume if isSelectionMode just turned true, we pushed).
            // Actually, simply pushing state here might cause issues if we toggle it rapidly or from popstate.
            // Better strategy: Only handle POPSTATE to close.
            // AND push state when user INTENTIONALLY triggers selection.

            // However, to keep it sync with React state:
            const handlePopState = (e) => {
                // If back is pressed, close selection mode
                // We consume the event by updating state.
                // The browser has already navigated back in history stack.
                setIsSelectionMode(false);
                setSelectedBooks(new Set());
                setSelectedFolders(new Set());
            };

            window.addEventListener('popstate', handlePopState);
            return () => {
                window.removeEventListener('popstate', handlePopState);
            };
        }
    }, [isSelectionMode]);

    const enterSelectionMode = () => {
        if (!isSelectionMode) {
            setIsSelectionMode(true);
            // Push a history entry so 'Back' has something to pop
            window.history.pushState({ selection: true }, '');
        }
    };

    const exitSelectionMode = () => {
        if (isSelectionMode) {
            // If we are exiting via UI (Cancel button), we should ideally pop the history state we pushed.
            // Check if current state is the one we pushed?
            if (window.history.state?.selection) {
                window.history.back(); // This will trigger popstate, which sets isSelectionMode(false)
            } else {
                // Fallback if no state
                setIsSelectionMode(false);
                setSelectedBooks(new Set());
                setSelectedFolders(new Set());
            }
        }
    };

    // Save state on change
    useEffect(() => {
        const f = searchParams.get('folder');
        const t = searchParams.get('tab');
        if (f) sessionStorage.setItem('repo_last_folder', f);
        else sessionStorage.removeItem('repo_last_folder');

        if (t) sessionStorage.setItem('repo_last_tab', t);
    }, [searchParams]);

    useEffect(() => {
        if (showRenameDialog && renameInputRef.current && renameValue) {
            // Delay slightly to ensure focus is applied by autoFocus or browser behavior
            setTimeout(() => {
                const input = renameInputRef.current;
                if (!input) return;
                input.select();
            }, 10);
        }
    }, [showRenameDialog]);

    const navigate = useNavigate();

    // Colors Config
    const colors = {
        bg: isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]',
        textMain: isDark ? 'text-white' : 'text-[#202328]',
        textSub: isDark ? 'text-gray-400' : 'text-gray-500',
        headerBg: isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]',
        cardBg: isDark ? 'bg-[#1C1C1E]' : 'bg-white',
        inputBg: isDark ? 'bg-[#2C2C2E]' : 'bg-white',
        inputBorder: isDark ? 'border-transparent' : 'border-gray-100 border',
        iconBtn: isDark ? 'bg-[#2C2C2E] text-white' : 'bg-white text-[#202328]',
        divider: isDark ? 'divide-gray-800' : 'divide-gray-50',
        itemHover: isDark ? 'active:bg-[#2C2C2E]' : 'active:bg-gray-50',
        folderIconBg: isEInk ? 'bg-transparent border border-black' : (isDark ? 'bg-blue-900/30' : 'bg-blue-50'),
        folderIconText: isEInk ? 'text-black' : (isDark ? 'text-blue-400' : 'text-blue-500'),
    };

    // 默认封面配色
    const coverColors = {
        bg: isEInk ? '#FFFFFF' : (isDark ? '#3A3A3C' : '#fdf6e3'),
        border: isEInk ? '#000000' : (isDark ? '#1C1C1E' : '#8c7b64'),
        dashed: isEInk ? '#000000' : (isDark ? '#48484A' : '#d6c6ac'),
        text: isEInk ? 'text-black' : (isDark ? 'text-gray-300' : 'text-gray-800')
    };

    useEffect(() => {
        if (currentFolder) {
            const title = activeTab === 'personal' ? currentFolder.name : currentFolder;
            document.title = title;
        } else {
            document.title = activeTab === 'personal' ? '个人书库' : '公共书库';
        }
    }, [currentFolder, activeTab]);

    useEffect(() => {
        const userData = JSON.parse(localStorage.getItem('user') || '{}');
        setUser(userData);
    }, []);

    const switchTab = (tab) => {
        setSearchParams({ tab });
        exitSelectionMode();
    };

    const fetchBookshelfFolders = async () => {
        try {
            const bsFoldersRes = await fetch('/api/books/bookshelf/folders', { credentials: 'include' });
            if (bsFoldersRes.ok) {
                setBookshelfFolders(await bsFoldersRes.json());
            }
        } catch (error) {
            console.error(error);
        }
    };

    const fetchPersonalFolders = async () => {
        try {
            const foldersRes = await fetch('/api/books/folders', { credentials: 'include' });
            if (foldersRes.ok) {
                const foldersData = await foldersRes.json();
                setFolders(foldersData);
                sessionStorage.setItem('repo_folders_cache', JSON.stringify(foldersData));
            }
        } catch (error) {
            console.error(error);
        }
    };

    const parsePublicFolder = (folderValue) => {
        const parts = (folderValue || '').split('/').filter(Boolean);
        if (parts.length === 0) return { library: '', path: '' };
        return { library: parts[0], path: parts.slice(1).join('/') };
    };

    const fetchData = async (reset = true) => {
        if (reset) {
            setLoading(true);
            setLoadingMore(false);
            setOffset(0);
            setHasMore(false);
        } else {
            setLoadingMore(true);
        }

        const currentOffset = reset ? 0 : offset;

        try {
            if (activeTab === 'public') {
                if (!currentFolderParam) {
                    const libsRes = await fetch('/api/books/public/libraries', { credentials: 'include' });
                    if (libsRes.ok) {
                        const data = await libsRes.json();
                        setPublicFolders(data.folders || []);
                    } else {
                        setPublicFolders([]);
                    }
                    setBooks([]);
                    setTotalBooks(0);
                    setOffset(0);
                    setHasMore(false);
                    sessionStorage.setItem('repo_active_books_cache', JSON.stringify([]));
                } else {
                    const { library, path } = parsePublicFolder(currentFolderParam);
                    const params = new URLSearchParams();
                    params.set('library', library);
                    if (path) params.set('path', path);
                    params.set('limit', String(PAGE_SIZE));
                    params.set('offset', String(currentOffset));
                    
                    // 增加搜索参数拼接
                    if (searchQuery.trim()) {
                        params.set('search', searchQuery.trim());
                    }

                    const res = await fetch(`/api/books/public?${params.toString()}`, { credentials: 'include' });
                    if (res.ok) {
                        const data = await res.json();
                        const pageBooks = data.books || [];
                        const mergedBooks = reset ? pageBooks : [...books, ...pageBooks];
                        setPublicFolders(data.folders || []);
                        setBooks(mergedBooks);
                        setTotalBooks(data.total || 0);
                        const nextOffset = currentOffset + pageBooks.length;
                        setOffset(nextOffset);
                        setHasMore(nextOffset < (data.total || 0));
                        sessionStorage.setItem('repo_active_books_cache', JSON.stringify(mergedBooks));
                    }
                }
            } else {
                const params = new URLSearchParams();
                params.set('limit', String(PAGE_SIZE));
                params.set('offset', String(currentOffset));
                if (searchQuery.trim()) {
                    params.set('search', searchQuery.trim());
                } else if (currentFolder && currentFolder.id) {
                    params.set('folder_id', String(currentFolder.id));
                } else {
                    params.set('root', '1');
                }

                const res = await fetch(`/api/books/personal?${params.toString()}`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    const pageBooks = data.books || [];
                    const mergedBooks = reset ? pageBooks : [...books, ...pageBooks];
                    setBooks(mergedBooks);
                    setPublicFolders([]);
                    setTotalBooks(data.total || 0);
                    const nextOffset = currentOffset + pageBooks.length;
                    setOffset(nextOffset);
                    setHasMore(nextOffset < (data.total || 0));
                    sessionStorage.setItem('repo_active_books_cache', JSON.stringify(mergedBooks));
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            if (reset) setLoading(false);
            else setLoadingMore(false);
        }
    };

    useEffect(() => {
        fetchBookshelfFolders();
    }, []);

    useEffect(() => {
        if (activeTab === 'personal') {
            fetchPersonalFolders();
        }
    }, [activeTab]);

    useEffect(() => {
        fetchData(true);
    }, [activeTab, currentFolderParam, searchQuery]);

    useEffect(() => {
        if (loading || loadingMore || !hasMore) return;
        const node = loadMoreRef.current;
        if (!node) return;

        const observer = new IntersectionObserver((entries) => {
            const [entry] = entries;
            if (entry.isIntersecting) {
                fetchData(false);
            }
        }, { rootMargin: '200px' });

        observer.observe(node);
        return () => observer.disconnect();
    }, [loading, loadingMore, hasMore, offset, activeTab, currentFolderParam, searchQuery]);

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        if (currentFolder && activeTab === 'personal') formData.append('folder_id', currentFolder.id);
        try {
            const res = await fetch('/api/books', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
            if (res.ok) fetchData();
            else showToast.error('上传失败');
        } catch (error) { console.error(error); } finally { setUploading(false); e.target.value = ''; }
    };

    const createFolder = async () => {
        if (!newFolderName.trim()) return;
        if (folders.some(f => f.name === newFolderName.trim())) {
            showToast.warning('文件夹已存在');
            return;
        }
        try {
            const res = await fetch('/api/books/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newFolderName }),
                credentials: 'include'
            });
            if (res.ok) { fetchData(); setShowFolderDialog(false); setNewFolderName(''); }
            else { showToast.error('创建文件夹失败'); }
        } catch (e) { console.error(e); showToast.error('网络错误'); }
    };

    const deleteFolder = async (id, e) => {
        if (e) e.stopPropagation();
        try {
            const res = await fetch(`/api/books/folders/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (res.ok) fetchData();
        } catch (e) { console.error(e); }
    };

    const handleBatchMove = async (folderId) => {
        try {
            if (selectedBooks.size > 0) {
                const res = await fetch('/api/books/move', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookIds: Array.from(selectedBooks), folderId: folderId }),
                    credentials: 'include'
                });
                if (res.ok) { fetchData(); exitSelectionMode(); }
            }
        } catch (e) { console.error(e); }
    };

    const handleBatchDelete = () => {
        // In Public tab, folders cannot be deleted.
        const total = selectedBooks.size + (activeTab === 'personal' ? selectedFolders.size : 0);
        setDeleteConfirmation({ type: 'batch', count: total });
    };

    const performBatchDelete = async () => {
        try {
            // Delete Books
            await Promise.all(Array.from(selectedBooks).map(id =>
                fetch(`/api/books/${id}`, { method: 'DELETE', credentials: 'include' })
            ));
            // Delete Folders (Only in Personal Tab)
            if (activeTab === 'personal') {
                await Promise.all(Array.from(selectedFolders).map(id =>
                    fetch(`/api/books/folders/${id}`, { method: 'DELETE', credentials: 'include' })
                ));
            }

            fetchData();
            exitSelectionMode();
        } catch (e) { console.error(e); }
    };

    const handleConfirmDelete = async () => {
        if (!deleteConfirmation) return;
        const { type, id } = deleteConfirmation;

        if (type === 'batch') {
            await performBatchDelete();
        } else if (type === 'folder') {
            await deleteFolder(id);
        } else if (type === 'book') {
            await deleteBook(id);
        } else if (type === 'remove_from_bookshelf') {
            await performRemoveFromBookshelf(id);
        }
        setDeleteConfirmation(null);
    };

    const toggleFolderSelection = (id) => {
        if (activeTab === 'public') return;
        const newSet = new Set(selectedFolders);
        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
        setSelectedFolders(newSet);
    };

    const handleTouchStart = (type, id, name) => {
        longPressTimer.current = setTimeout(() => {
            if (activeTab === 'public' && type === 'folder') {
                if (user.role === 'admin') {
                    setActionMenuTarget({ type: 'folder', id, name });
                }
            } else {
                enterSelectionMode();
                if (type === 'folder') toggleFolderSelection(id);
                else toggleSelection(id);
            }
        }, 500);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };

    const handleActionMenu = (action) => {
        if (!actionMenuTarget) return;
        const { type, id, name } = actionMenuTarget;
        setActionMenuTarget(null);
        switch (action) {
            case 'rename':
                setRenameTarget({ type, id, name });
                setRenameValue(type === 'book' ? name.replace(/\.(txt|epub|mobi|azw3|pdf|md|fb2|cbz|cbr)$/i, '') : name);
                setShowRenameDialog(true);
                break;
            case 'delete':
                setDeleteConfirmation({ type, id, name });
                break;
            case 'select': enterSelectionMode(); if (type === 'book') toggleSelection(id); break;
            default: break;
        }
    };

    const deleteBook = async (id) => {
        try {
            const res = await fetch(`/api/books/${id}`, { method: 'DELETE', credentials: 'include' });
            if (res.ok) {
                fetchData();
                if (selectedBooks.has(id)) { const newSet = new Set(selectedBooks); newSet.delete(id); setSelectedBooks(newSet); }
            }
        } catch (e) { console.error(e); }
    };

    const handleRename = async () => {
        if (!renameValue.trim() || !renameTarget) return;
        try {
            let url = '';
            let body = {};
            if (renameTarget.type === 'folder') {
                url = activeTab === 'public' ? `/api/admin/libraries/${renameTarget.id}/rename` : `/api/books/folders/${renameTarget.id}/rename`;
                body = { name: renameValue };
            } else {
                const oldName = renameTarget.name;
                const ext = oldName.substring(oldName.lastIndexOf('.'));
                let newName = renameValue;
                if (!newName.toLowerCase().endsWith(ext.toLowerCase())) newName += ext;
                url = `/api/books/${renameTarget.id}/rename`;
                body = { title: newName };
            }
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'include'
            });
            if (res.ok) {
                fetchData(); setShowRenameDialog(false); setRenameTarget(null); setRenameValue(''); exitSelectionMode();
            }
        } catch (e) { console.error(e); }
    };

    const handleAddToBookshelf = async (bookId) => {
        // Single book add - open folder selection dialog
        setPendingBookId(bookId);
        setShowBookshelfFolderDialog(true);
    };

    const handleRemoveFromBookshelf = (bookId) => {
        const book = books.find(b => b.id === bookId);
        setDeleteConfirmation({ type: 'remove_from_bookshelf', id: bookId, name: book ? book.title : '' });
    };

    const performRemoveFromBookshelf = async (bookId) => {
        // 乐观更新：立即更新本地状态
        setBooks(prev => prev.map(b => b.id === bookId ? { ...b, in_bookshelf: 0 } : b));
        showToast.success('已移出书架');

        // 通知书架页
        sessionStorage.removeItem('library_books_cache');
        window.dispatchEvent(new CustomEvent('library-refresh', { detail: { action: 'remove', bookIds: [bookId] } }));

        // 后台静默请求
        try {
            const res = await fetch(`/api/books/bookshelf/${bookId}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) showToast.error('移出书架失败，请重试');
        } catch (e) {
            console.error(e);
            showToast.error('网络错误，请重试');
        }
    };

    const toggleSelection = (id) => {
        const newSet = new Set(selectedBooks);
        newSet.has(id) ? newSet.delete(id) : newSet.add(id);
        setSelectedBooks(newSet);
    };

    const handleBatchAddToBookshelf = async () => {
        const booksToAdd = books.filter(b => selectedBooks.has(b.id) && b.in_bookshelf != 1);

        if (booksToAdd.length === 0) {
            if (selectedBooks.size > 0) {
                showToast.info('选中的书籍都已在书架中');
            }
            exitSelectionMode();
            return;
        }

        // Open folder selection dialog
        setShowBookshelfFolderDialog(true);
    };

    const confirmAddToBookshelf = async (folderId) => {
        // Determine book IDs: single book (pendingBookId) or batch (selectedBooks)
        const bookIdsToAdd = pendingBookId ? [pendingBookId] : Array.from(selectedBooks);

        // 乐观更新：立即更新本地状态
        const addedIds = new Set(bookIdsToAdd);
        setBooks(prev => prev.map(b => addedIds.has(b.id) ? { ...b, in_bookshelf: 1, bookshelf_folder_id: folderId } : b));
        setShowBookshelfFolderDialog(false);
        setNewBookshelfFolderName('');
        setPendingBookId(null);
        exitSelectionMode();
        showToast.success(`已将 ${bookIdsToAdd.length} 本书加入书架`);

        // 通知书架页
        sessionStorage.removeItem('library_books_cache');
        const addedBooks = books.filter(b => bookIdsToAdd.includes(b.id)).map(b => ({
            ...b, in_bookshelf: 1, bookshelf_folder_id: folderId || null
        }));
        window.dispatchEvent(new CustomEvent('library-refresh', { detail: { action: 'add', books: addedBooks } }));

        // 后台静默请求
        try {
            const res = await fetch('/api/books/bookshelf/batch', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookIds: bookIdsToAdd, folderId: folderId || null }),
                credentials: 'include'
            });
            if (!res.ok) showToast.error('加入书架失败，请重试');
        } catch (e) {
            console.error(e);
            showToast.error('网络错误，请重试');
        }
    };

    const createBookshelfFolderAndAdd = async () => {
        if (!newBookshelfFolderName.trim()) return;
        try {
            const res = await fetch('/api/books/bookshelf/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newBookshelfFolderName.trim() }),
                credentials: 'include'
            });
            if (res.ok) {
                const newFolder = await res.json();
                setBookshelfFolders(prev => [...prev, newFolder]);
                await confirmAddToBookshelf(newFolder.id);
            }
        } catch (e) {
            console.error(e);
            showToast.error('创建文件夹失败');
        }
    };

    const handleSelectAll = () => {
        // Only select books, as folders are handled separately or not selectable in public
        const allBookIds = displayBooks.map(b => b.id);

        // If all currently displayed books are selected, deselect all (of visible)
        // Note: This simple logic toggles based on visible. 
        const allSelected = allBookIds.every(id => selectedBooks.has(id));

        if (allSelected) {
            // Deselect all visible books
            const newSet = new Set(selectedBooks);
            allBookIds.forEach(id => newSet.delete(id));
            setSelectedBooks(newSet);
        } else {
            // Select all visible books
            const newSet = new Set(selectedBooks);
            allBookIds.forEach(id => newSet.add(id));
            setSelectedBooks(newSet);
        }
    };

    // --- Display Logic ---
    const displayFolders = useMemo(() => {
        if (activeTab === 'public') return publicFolders;
        if (searchQuery.trim()) return [];
        if (currentFolder) return [];
        return folders;
    }, [activeTab, publicFolders, searchQuery, currentFolder, folders]);

    const displayBooks = books;

    // --- Render ---
    const renderHeader = () => (
        <div className={`px-4 py-3 sticky top-0 z-20 space-y-3 ${colors.headerBg}`}>
            <div className="flex items-center justify-between">
                {isSelectionMode ? (
                    <div className="flex items-center gap-3 w-full">
                        <span className={`font-bold text-lg ${colors.textMain}`}>已选 {selectedBooks.size + selectedFolders.size} 项</span>
                        <div className="flex-1"></div>

                        <div className="flex items-center gap-3">
                            {/* Select All */}
                            <button
                                onClick={handleSelectAll}
                                className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}
                            >
                                {displayBooks.length > 0 && displayBooks.every(b => selectedBooks.has(b.id)) ? (
                                    <CheckSquare className="w-5 h-5 text-blue-500" />
                                ) : (
                                    <Square className="w-5 h-5" />
                                )}
                            </button>

                            {(selectedBooks.size > 0 || selectedFolders.size > 0) && (
                                <>
                                    {/* Batch Add to Bookshelf (Public Only) */}
                                    {activeTab === 'public' && (
                                        <button onClick={handleBatchAddToBookshelf} className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn} text-orange-500`} title="加入书架"><BookPlus className="w-5 h-5" /></button>
                                    )}

                                    {activeTab === 'personal' && selectedFolders.size === 0 && (
                                        <button onClick={() => setShowFolderDialog(true)} className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn} text-blue-500`}><FolderPlus className="w-5 h-5" /></button>
                                    )}

                                    {/* Delete Button (Personal or Admin) */}
                                    {((activeTab === 'personal') || (activeTab === 'public' && user.role === 'admin')) && (
                                        <button onClick={handleBatchDelete} className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn} text-red-500`}><Trash2 className="w-5 h-5" /></button>
                                    )}
                                </>
                            )}

                            {/* Cancel Selection (X) - Matching Library.jsx */}
                            <button
                                onClick={exitSelectionMode}
                                className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 w-full">
                        {currentFolder && (
                            <>
                                <button onClick={() => {
                                    if (activeTab === 'personal') {
                                        setSearchParams({ tab: activeTab });
                                    } else {
                                        // Public Back Navigation
                                        if (currentFolder.includes('/')) {
                                            const parent = currentFolder.substring(0, currentFolder.lastIndexOf('/'));
                                            setSearchParams({ tab: activeTab, folder: parent });
                                        } else {
                                            setSearchParams({ tab: activeTab });
                                        }
                                    }
                                }} className={`p-2 -ml-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`} title="返回上一级">
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                                <span className={`text-xl font-bold truncate ${colors.textMain}`}>
                                    {activeTab === 'personal' ? currentFolder.name : currentFolder}
                                </span>
                            </>
                        )}
                        {!currentFolder && (
                            <span className={`text-[28px] font-bold tracking-tight ${colors.textMain}`}>书库</span>
                        )}

                        {!currentFolder && (
                            <div className={`ml-auto flex rounded-lg p-0.5 ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                <button onClick={() => switchTab('public')} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'public' ? `${colors.cardBg} ${colors.textMain} shadow-sm` : colors.textSub}`}>公共</button>
                                <button onClick={() => switchTab('personal')} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'personal' ? `${colors.cardBg} ${colors.textMain} shadow-sm` : colors.textSub}`}>个人</button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {(activeTab === 'personal' || (activeTab === 'public' && currentFolder)) && (
                <div className="relative">
                    <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${colors.textSub}`} />
                    <input
                        type="text"
                        placeholder={activeTab === 'personal' ? "搜索我的书籍..." : "在当前书库中搜索..."}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={`w-full pl-10 pr-4 py-3 border-none rounded-[16px] text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 ${colors.inputBg} ${colors.textMain} placeholder:${isDark ? 'text-gray-600' : 'text-gray-400'}`}
                    />
                </div>
            )}
        </div>
    );

    return (
        <div className={`min-h-full flex flex-col pb-24 ${colors.bg} transition-colors duration-200 ${isEInk ? 'reader-theme-e-ink' : ''}`}>
            {renderHeader()}

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-gray-300" /></div>
            ) : (
                <div className="px-4 space-y-6">

                    {/* Folders List */}
                    {displayFolders.length > 0 && (
                        <div>
                            <div className={`pl-2 pb-2 text-xs font-medium ${colors.textSub}`}>
                                {activeTab === 'personal' ? '文件夹' : '书库分类'}
                            </div>
                            <div className={`${colors.cardBg} rounded-[20px] overflow-hidden shadow-sm divide-y ${colors.divider}`}>
                                {displayFolders.map((folder, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => {
                                            if (isSelectionMode) {
                                                toggleFolderSelection(folder.id);
                                                return;
                                            }
                                            const folderValue = activeTab === 'personal'
                                                ? folder.id
                                                : (currentFolder ? `${currentFolder}/${folder.name}` : folder.name);

                                            const newParams = new URLSearchParams(searchParams);
                                            newParams.set('tab', activeTab);
                                            newParams.set('folder', folderValue);
                                            // Use push to ensure back button works
                                            navigate(`?${newParams.toString()}`, { replace: false });
                                        }}
                                        onTouchStart={() => handleTouchStart('folder', folder.id, folder.name, folder.is_public_lib)}
                                        onTouchEnd={handleTouchEnd}
                                        onMouseDown={() => handleTouchStart('folder', folder.id, folder.name, folder.is_public_lib)}
                                        onMouseUp={handleTouchEnd}
                                        onMouseLeave={handleTouchEnd}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            if (activeTab === 'personal' || (activeTab === 'public' && user.role === 'admin' && folder.is_public_lib)) {
                                                setActionMenuTarget({ type: 'folder', id: folder.id, name: folder.name });
                                            }
                                        }}
                                        className={`w-full flex items-center justify-between p-4 transition-colors group cursor-pointer ${isSelectionMode && selectedFolders.has(folder.id) ? 'bg-blue-500/10' : colors.itemHover}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-[14px] ${colors.folderIconBg} ${colors.folderIconText}`}>
                                                {isSelectionMode && selectedFolders.has(folder.id) ? <Check className="w-5 h-5" /> : <Folder className="w-5 h-5 fill-current" />}
                                            </div>
                                            <div className="text-left">
                                                <span className={`text-[15px] font-medium block ${colors.textMain}`}>{folder.name}</span>
                                                {activeTab === 'public' && <span className="text-xs text-gray-400">{folder.count} 本书</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {activeTab === 'personal' && !isSelectionMode && !isFnOSMobile && (
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setRenameTarget({ type: 'folder', id: folder.id, name: folder.name });
                                                            setRenameValue(folder.name);
                                                            setShowRenameDialog(true);
                                                        }}
                                                        className={`p-1.5 rounded-lg ${isDark ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-900/30' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'}`}
                                                        title="重命名"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDeleteConfirmation({ type: 'folder', id: folder.id, name: folder.name });
                                                        }}
                                                        className={`p-1.5 rounded-lg ${isDark ? 'text-gray-400 hover:text-red-400 hover:bg-red-900/30' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'}`}
                                                        title="删除"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                            {activeTab === 'public' && user.role === 'admin' && !isSelectionMode && !isFnOSMobile && folder.id && false && (
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {/* Only Rename for Admin in Public Tab - No Delete */}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setRenameTarget({ type: 'folder', id: folder.id, name: folder.name });
                                                            setRenameValue(folder.name);
                                                            setShowRenameDialog(true);
                                                        }}
                                                        className={`p-1.5 rounded-lg ${isDark ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-900/30' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'}`}
                                                        title="重命名"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                            <ChevronRight className={`w-5 h-5 ${colors.textSub}`} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Books Grid -> List */}
                    {displayBooks.length > 0 && (
                        <div>
                            <div className={`pl-2 pb-2 text-xs font-medium ${colors.textSub}`}>书籍</div>
                            <div className={`${colors.cardBg} rounded-[20px] overflow-hidden shadow-sm divide-y ${colors.divider}`}>
                                {displayBooks.map(book => {
                                    const canEdit = (activeTab === 'personal' || (activeTab === 'public' && user.role === 'admin'));
                                    return (
                                        <RepoBookItem
                                            key={book.id}
                                            book={book}
                                            isSelectionMode={isSelectionMode}
                                            isSelected={selectedBooks.has(book.id)}
                                            onClick={() => {
                                                if (isSelectionMode) toggleSelection(book.id);
                                                else navigate(`/read/${book.id}`);
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault(); // Important to prevent browser menu
                                                if (isSelectionMode) return;
                                                setActionMenuTarget({ type: 'book', id: book.id, name: book.title });
                                            }}
                                            handleAddToBookshelf={handleAddToBookshelf}
                                            handleRemoveFromBookshelf={handleRemoveFromBookshelf}
                                            onToggleSelection={toggleSelection}
                                            onRename={canEdit ? () => {
                                                setRenameTarget({ type: 'book', id: book.id, name: book.title });
                                                setRenameValue(book.title.replace(/\.(txt|epub|mobi|azw3|pdf|md|fb2|cbz|cbr)$/i, ''));
                                                setShowRenameDialog(true);
                                            } : null}
                                            onDelete={canEdit ? () => {
                                                setDeleteConfirmation({ type: 'book', id: book.id, name: book.title });
                                            } : null}
                                            isFnOSMobile={isFnOSMobile}
                                            colors={colors}
                                            isDark={isDark}
                                            isEInk={isEInk}
                                        />
                                    );
                                })}
                            </div>
                            <div ref={loadMoreRef} className="py-3 flex justify-center">
                                {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
                            </div>
                        </div>
                    )}

                    {/* Empty State */}
                    {displayFolders.length === 0 && displayBooks.length === 0 && (
                        <div className={`text-center py-20 flex flex-col items-center ${colors.textSub}`}>
                            <Book className="w-12 h-12 mb-2 opacity-20" />
                            <p className="text-sm">暂无内容</p>
                        </div>
                    )}
                </div>
            )}

            {/* FABs */}
            {activeTab === 'personal' && !isSelectionMode && (
                <div className="fixed bottom-24 right-6 flex flex-col gap-3 z-40">
                    {!currentFolder && (
                        <button
                            onClick={() => setShowFolderDialog(true)}
                            className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center border transition-all hover:scale-105 active:scale-95 ${isDark ? 'bg-[#2C2C2E] border-gray-700 text-gray-300' : 'bg-white border-gray-100 text-gray-600'}`}
                        >
                            <FolderPlus className="w-6 h-6" />
                        </button>
                    )}
                    <label className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center cursor-pointer transition-all hover:scale-105 active:scale-95 z-30 ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>
                        {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-7 h-7" />}
                        <input type="file" className="hidden" accept=".epub,.txt,.pdf,.mobi,.azw3" disabled={uploading} onChange={handleUpload} />
                    </label>
                </div>
            )}

            {/* Folder Dialog */}
            {showFolderDialog && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${colors.cardBg} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-4 ${colors.textMain}`}>
                            {isSelectionMode ? '移动到文件夹' : '新建文件夹'}
                        </h3>

                        {isSelectionMode ? (
                            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                                {currentFolder && (
                                    <button
                                        onClick={() => { handleBatchMove(null); setShowFolderDialog(false); }}
                                        className={`w-full text-left px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors ${colors.itemHover} ${isDark ? 'border-gray-800' : 'border-gray-100'}`}
                                    >
                                        <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}><Book className={`w-4 h-4 ${colors.textSub}`} /></div>
                                        <span className={colors.textMain}>根目录</span>
                                    </button>
                                )}
                                {folders.map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => { handleBatchMove(f.id); setShowFolderDialog(false); }}
                                        className={`w-full text-left px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors ${colors.itemHover} ${isDark ? 'border-gray-800' : 'border-gray-100'}`}
                                    >
                                        <div className={`p-2 rounded-lg ${colors.folderIconBg}`}><Folder className={`w-4 h-4 ${colors.folderIconText}`} /></div>
                                        <span className={colors.textMain}>{f.name}</span>
                                    </button>
                                ))}

                                {/* Create new folder inline */}
                                <div className={`pt-3 border-t mt-2 ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
                                    <p className={`text-xs mb-2 ${colors.textSub}`}>或者新建文件夹并移动</p>
                                    <div className="flex flex-col gap-2">
                                        <input
                                            type="text"
                                            placeholder="新文件夹名称"
                                            value={newFolderName}
                                            onChange={(e) => setNewFolderName(e.target.value)}
                                            className={`w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 ${colors.inputBg} ${colors.textMain} ${colors.inputBorder}`}
                                        />
                                        <button
                                            onClick={async () => {
                                                if (!newFolderName.trim()) {
                                                    showToast.warning('文件夹名称不能为空');
                                                    return;
                                                }
                                                if (folders.some(f => f.name === newFolderName.trim())) {
                                                    showToast.warning('文件夹已存在');
                                                    return;
                                                }
                                                try {
                                                    const res = await fetch('/api/books/folders', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ name: newFolderName }),
                                                        credentials: 'include'
                                                    });
                                                    if (res.ok) {
                                                        const newFolder = await res.json();
                                                        handleBatchMove(newFolder.id);
                                                        setShowFolderDialog(false);
                                                        setNewFolderName('');
                                                    }
                                                } catch (e) { console.error(e); }
                                            }}
                                            disabled={!newFolderName.trim()}
                                            className={`w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium transition-opacity ${!newFolderName.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            创建并移动
                                        </button>
                                    </div>
                                </div>
                                <button onClick={() => setShowFolderDialog(false)} className={`mt-2 w-full py-2 text-sm ${colors.textSub} hover:${colors.textMain}`}>取消</button>
                            </div>
                        ) : (
                            <>
                                <input
                                    type="text" placeholder="文件夹名称" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
                                    className={`w-full px-4 py-3 border-none rounded-xl mb-6 focus:ring-2 focus:ring-blue-500/20 outline-none ${colors.inputBg} ${colors.textMain}`} autoFocus
                                />
                                <div className="flex gap-3">
                                    <button onClick={() => setShowFolderDialog(false)} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>取消</button>
                                    <button
                                        onClick={createFolder}
                                        disabled={!newFolderName.trim()}
                                        className={`flex-1 py-3 rounded-xl font-medium transition-opacity ${!newFolderName.trim() ? 'opacity-50 cursor-not-allowed' : ''} ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}
                                    >
                                        创建
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Rename Dialog */}
            {showRenameDialog && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${colors.cardBg} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-4 ${colors.textMain}`}>重命名</h3>
                        <input
                            ref={renameInputRef}
                            type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                            className={`w-full px-4 py-3 border-none rounded-xl mb-6 focus:ring-2 focus:ring-blue-500/20 outline-none ${colors.inputBg} ${colors.textMain}`} autoFocus
                        />
                        <div className="flex gap-3">
                            <button onClick={() => setShowRenameDialog(false)} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>取消</button>
                            <button onClick={handleRename} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>确定</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            {deleteConfirmation && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${colors.cardBg} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-2 ${colors.textMain}`}>
                            {deleteConfirmation.type === 'remove_from_bookshelf' ? '移出书架' : '确认删除'}
                        </h3>
                        <p className={`text-sm mb-6 ${colors.textSub}`}>
                            {deleteConfirmation.type === 'batch'
                                ? `确定要删除选中的 ${deleteConfirmation.count} 项吗？\n删除会删除源文件。`
                                : deleteConfirmation.type === 'folder'
                                    ? `确定要删除文件夹 "${deleteConfirmation.name}" 吗？文件夹内的书籍将移至根目录。`
                                    : deleteConfirmation.type === 'remove_from_bookshelf'
                                        ? `确定要将 "${deleteConfirmation.name}" 移出书架吗？`
                                        : `确定要删除书籍 "${deleteConfirmation.name}" 吗？\n删除会删除源文件。`
                            }
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirmation(null)}
                                className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                className={`flex-1 py-3 rounded-xl font-medium bg-red-500 text-white shadow-lg shadow-red-500/30`}
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bookshelf Folder Selection Dialog */}
            {showBookshelfFolderDialog && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${colors.cardBg} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-4 ${colors.textMain}`}>选择书架位置</h3>
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                            {/* Root Option */}
                            <button
                                onClick={() => confirmAddToBookshelf(null)}
                                className={`w-full text-left px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors ${isDark ? 'border-gray-800 hover:bg-[#2C2C2E]' : 'border-gray-100 hover:bg-gray-50'}`}
                            >
                                <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}><Book className={`w-4 h-4 ${colors.textSub}`} /></div>
                                <span className={colors.textMain}>书架根目录</span>
                            </button>

                            {/* Existing Folders */}
                            {bookshelfFolders.map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => confirmAddToBookshelf(f.id)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors ${isDark ? 'border-gray-800 hover:bg-[#2C2C2E]' : 'border-gray-100 hover:bg-gray-50'}`}
                                >
                                    <div className={`p-2 rounded-lg ${isDark ? 'bg-blue-900/30' : 'bg-blue-50'}`}><Folder className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} /></div>
                                    <span className={colors.textMain}>{f.name}</span>
                                </button>
                            ))}

                            {/* Create New Folder Section */}
                            <div className={`pt-3 border-t mt-2 ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
                                <p className={`text-xs mb-2 ${colors.textSub}`}>或者新建文件夹并加入</p>
                                <div className="flex flex-col gap-2">
                                    <input
                                        type="text"
                                        placeholder="新文件夹名称"
                                        value={newBookshelfFolderName}
                                        onChange={(e) => setNewBookshelfFolderName(e.target.value)}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 ${colors.inputBg} ${colors.textMain} ${isDark ? 'border-transparent' : 'border-gray-100'}`}
                                    />
                                    <button
                                        onClick={createBookshelfFolderAndAdd}
                                        className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
                                    >
                                        创建并加入
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowBookshelfFolderDialog(false); setNewBookshelfFolderName(''); setPendingBookId(null); }}
                                className={`mt-2 w-full py-2 text-sm ${colors.textSub} hover:${colors.textMain}`}
                            >
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Context Menu */}
            {actionMenuTarget && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm" onClick={() => setActionMenuTarget(null)}>
                    <div className={`${colors.cardBg} w-full sm:w-80 rounded-t-2xl sm:rounded-2xl overflow-hidden p-2 space-y-1 animate-in slide-in-from-bottom-10`} onClick={e => e.stopPropagation()}>
                        <div className={`px-4 py-3 text-sm font-medium text-center border-b mb-1 truncate ${colors.textSub} ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>{actionMenuTarget.name}</div>

                        {actionMenuTarget.type === 'book' && (
                            <button
                                onClick={() => {
                                    const book = books.find(b => b.id === actionMenuTarget.id);
                                    if (book && book.in_bookshelf != 1) handleAddToBookshelf(actionMenuTarget.id);
                                    setActionMenuTarget(null);
                                }}
                                className={`w-full py-3.5 rounded-xl flex items-center justify-center gap-2 font-medium ${books.find(b => b.id === actionMenuTarget.id)?.in_bookshelf == 1 ? 'text-gray-400 opacity-50' : 'text-orange-500 bg-orange-50/10'}`}
                            >
                                <Book className="w-5 h-5" /> {books.find(b => b.id === actionMenuTarget.id)?.in_bookshelf == 1 ? '已在书架' : '加入书架'}
                            </button>
                        )}

                        {(activeTab === 'personal' || user.role === 'admin') && (
                            <button
                                onClick={() => { handleActionMenu('rename'); }}
                                className={`w-full py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 ${colors.itemHover} ${colors.textMain}`}
                            >
                                <Edit2 className="w-5 h-5 text-blue-500" /> 重命名
                            </button>
                        )}
                        {(activeTab === 'personal' || (user.role === 'admin' && actionMenuTarget.type === 'book')) && (
                            <button
                                onClick={() => { handleActionMenu('delete'); }}
                                className={`w-full py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 ${colors.itemHover} text-red-500`}
                            >
                                <Trash2 className="w-5 h-5" /> 删除
                            </button>
                        )}
                        {actionMenuTarget.type === 'book' && (
                            <button
                                onClick={() => { handleActionMenu('select'); }}
                                className={`w-full py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 ${colors.itemHover} ${colors.textMain}`}
                            >
                                <Check className="w-5 h-5 text-green-500" /> 多选
                            </button>
                        )}

                        <button onClick={() => setActionMenuTarget(null)} className={`w-full py-3.5 rounded-xl font-medium mt-2 ${colors.itemHover} ${colors.textSub} ${colors.cardBg}`}>
                            取消
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Repository;
