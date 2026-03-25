// 我的书架
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Book, Loader2, X, Check, Trash2, Search, FolderPlus, ArrowLeft, Edit2, FolderInput, Folder } from 'lucide-react';
import { useIsFnOSMobile } from '../hooks/useIsFnOSMobile';
import useLongPress from '../hooks/useLongPress';
import CoverEditorDialog from './CoverEditorDialog';

// 辅助函数：获取封面 URL（cookie 认证自动携带）
const getCoverUrl = (coverPath) => {
    if (!coverPath) return null;
    return coverPath;
};

const BookItem = ({ book, isSelectionMode, isSelected, onClick, onLongPress, colors, coverColors, getCoverUrl, onEditCover }) => {
    const bind = useLongPress(onLongPress, onClick);

    return (
        <div
            {...bind} // Apply the long press and click handlers
            className="group relative flex flex-col gap-2 cursor-pointer active:scale-95 transition-transform duration-200"
        >
            <div className={`aspect-[2/3] shadow-md rounded-r-lg border-l-4 flex flex-col overflow-hidden relative transition-all ${isSelectionMode && isSelected ? 'ring-2 ring-blue-500' : ''}`}
                style={{
                    backgroundColor: book.cover ? 'transparent' : coverColors.bg,
                    borderColor: coverColors.border
                }}
            >
                {book.cover ? (
                    <img
                        key={book.cover} // Add key to force re-render when cover changes
                        src={getCoverUrl(book.cover)}
                        alt={book.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            e.target.style.display = 'none';
                            // Find the fallback container (next sibling) and ensure it's displayed
                            const fallback = e.target.nextElementSibling;
                            if (fallback) {
                                fallback.classList.remove('hidden');
                                fallback.classList.add('flex');
                            }
                        }}
                    />
                ) : null}
                <div className={`flex-1 flex flex-col p-3 ${book.cover ? 'hidden' : 'flex'}`}>
                    <div className="flex-1 border-b border-dashed mb-2 flex items-center justify-center" style={{ borderColor: coverColors.dashed }}>
                        <h3 className={`font-serif font-bold text-xs leading-relaxed line-clamp-3 text-center break-all ${coverColors.text}`}>
                            {book.title.replace(/\.(txt|epub|mobi|azw3|pdf|md|fb2|cbz|cbr)$/i, '')}
                        </h3>
                    </div>
                    <div className="flex justify-between items-end text-[10px] text-gray-500 font-serif w-full">
                        <span className="shrink-0">{book.format.toUpperCase()}</span>
                        <div className="flex items-center gap-1 overflow-hidden ml-1 text-[9px] opacity-80">
                            {book.chapter_title && (
                                <span className="truncate max-w-[5rem]" title={book.chapter_title}>
                                    {book.chapter_title}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {!isSelectionMode && book.progress_percent > 0 && (
                    <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/60 rounded text-[9px] font-bold text-white backdrop-blur-sm shadow-sm border border-white/10">
                        {book.progress_percent}%
                    </div>
                )}

                {isSelectionMode && onEditCover && (
                    <>
                        <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white/80 border-gray-300'}`}>
                            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEditCover(book);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                className="w-full py-1 text-[10px] text-white border border-white/50 rounded bg-black/20 backdrop-blur-sm active:bg-white/20 hover:bg-white/30 transition-colors"
                            >
                                更改封面
                            </button>
                        </div>
                    </>
                )}
            </div>
            <div className={`text-center text-xs font-medium truncate px-1 ${colors.textMain}`}>{book.title.replace(/\.(txt|epub|mobi|azw3|pdf|md|fb2|cbz|cbr)$/i, '')}</div>
        </div>
    );
};

const Bookshelf = () => {
    const [books, setBooks] = useState(() => {
        try {
            const cached = sessionStorage.getItem('library_books_cache');
            return cached ? JSON.parse(cached) : [];
        } catch (e) { return []; }
    });
    const [loading, setLoading] = useState(books.length === 0);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedBooks, setSelectedBooks] = useState(new Set());
    const [deleteConfirmation, setDeleteConfirmation] = useState(null);
    const [user] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('user') || '{}');
        } catch (e) {
            return {};
        }
    });
    const [folders, setFolders] = useState(() => {
        try {
            const cached = sessionStorage.getItem('library_folders_cache');
            return cached ? JSON.parse(cached) : [];
        } catch (e) { return []; }
    }); // Bookshelf folders

    // URL Search Params for folder navigation
    const [searchParams, setSearchParams] = useSearchParams();
    const folderId = searchParams.get('folder');
    const currentFolder = folders.find(f => String(f.id) === folderId) || null;
    const [showFolderDialog, setShowFolderDialog] = useState(false); // Create/Merge folder dialog
    const [folderName, setFolderName] = useState('');
    const [isMergeMode, setIsMergeMode] = useState(false); // True: Merge selected, False: Create New
    const [renameTarget, setRenameTarget] = useState(null);
    const [showRenameDialog, setShowRenameDialog] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [actionFolder, setActionFolder] = useState(null); // Folder for long-press/context menu
    const navigate = useNavigate();
    // eslint-disable-next-line no-unused-vars
    const isFnOSMobile = useIsFnOSMobile();

    // Cover Editor State
    const [editingBook, setEditingBook] = useState(null);

    // 搜索状态
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchRef = React.useRef(null);

    // 点击外部关闭搜索
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setIsSearchOpen(false);
                setSearchQuery('');
            }
        };
        if (isSearchOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isSearchOpen]);

    // 主题状态
    const [theme, setTheme] = useState(localStorage.getItem('app_theme') || 'light');
    const isDark = theme === 'dark';
    const isEInk = theme === 'e-ink';

    useEffect(() => {
        // 使用事件监听替代轮询
        const handleThemeChange = () => setTheme(localStorage.getItem('app_theme') || 'light');
        const handleLibraryRefresh = (e) => {
            const detail = e?.detail;
            if (detail?.action === 'add' && detail.books) {
                // 乐观添加：将新书追加到本地状态
                setBooks(prev => {
                    const existingIds = new Set(prev.map(b => b.id));
                    const newBooks = detail.books.filter(b => !existingIds.has(b.id));
                    const updated = [...prev, ...newBooks];
                    sessionStorage.setItem('library_books_cache', JSON.stringify(updated));
                    return updated;
                });
                return;
            }
            if (detail?.action === 'remove' && detail.bookIds) {
                // 乐观移除：从本地状态移除
                const removeSet = new Set(detail.bookIds);
                setBooks(prev => {
                    const updated = prev.filter(b => !removeSet.has(b.id));
                    sessionStorage.setItem('library_books_cache', JSON.stringify(updated));
                    return updated;
                });
                return;
            }
            // 无 detail 数据时回退为全量刷新（兼容旧事件）
            fetchBooks();
        };
        window.addEventListener('theme-change', handleThemeChange);
        window.addEventListener('storage', handleThemeChange);
        window.addEventListener('library-refresh', handleLibraryRefresh);

        // 初始化数据
        fetchBooks();

        return () => {
            window.removeEventListener('theme-change', handleThemeChange);
            window.removeEventListener('storage', handleThemeChange);
            window.removeEventListener('library-refresh', handleLibraryRefresh);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 颜色配置
    const colors = {
        bg: isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]',
        textMain: isDark ? 'text-white' : 'text-[#202328]',
        headerBg: isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]',
        iconBtn: isDark ? 'bg-[#1C1C1E] text-white' : 'bg-white text-[#202328]',
        emptyText: isDark ? 'text-gray-600' : 'text-gray-300',
        emptyCard: isDark ? 'bg-[#1C1C1E]' : 'bg-white',
        inputBg: isDark ? 'bg-[#2C2C2E]' : 'bg-white',
        textSub: isEInk ? 'text-gray-600' : (isDark ? 'text-gray-400' : 'text-gray-500'),
    };

    // 默认封面配色
    const coverColors = {
        bg: isEInk ? '#FFFFFF' : (isDark ? '#3A3A3C' : '#fdf6e3'),
        border: isEInk ? '#000000' : (isDark ? '#1C1C1E' : '#8c7b64'),
        dashed: isEInk ? '#000000' : (isDark ? '#48484A' : '#d6c6ac'),
        text: isEInk ? 'text-black' : (isDark ? 'text-gray-300' : 'text-gray-800')
    };

    const fetchBooks = async () => {
        // 如果本地已加载数据，就不显示 Loading (SWR 体验)
        const shouldShowLoading = books.length === 0;
        if (shouldShowLoading) setLoading(true);

        try {
            const res = await fetch('/api/books?in_bookshelf=1', { credentials: 'include' });
            if (res.status === 401 || res.status === 403) {
                navigate('/login');
                return;
            }
            const shelfBooks = await res.json();
            setBooks(shelfBooks);
            sessionStorage.setItem('library_books_cache', JSON.stringify(shelfBooks));
        } catch (error) {
            console.error('Failed to fetch books:', error);
        } finally {
            if (shouldShowLoading) setLoading(false);
        }

        try {
            const foldersRes = await fetch('/api/books/bookshelf/folders', { credentials: 'include' });
            if (foldersRes.ok) {
                const foldersData = await foldersRes.json();
                setFolders(foldersData);
                sessionStorage.setItem('library_folders_cache', JSON.stringify(foldersData));
            }
        } catch (error) {
            console.error('Failed to fetch folders:', error);
        }
    };

    // History & Back Button Logic for Selection Mode
    useEffect(() => {
        const handlePopState = () => {
            if (isSelectionMode) {
                setIsSelectionMode(false);
                setSelectedBooks(new Set());
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isSelectionMode]);

    const enterSelectionMode = () => {
        if (!isSelectionMode) {
            setIsSelectionMode(true);
            window.history.pushState({ selection: true }, '');
        }
    };

    const exitSelectionMode = () => {
        if (isSelectionMode) {
            window.history.back();
        }
    };

    const toggleSelection = (id) => {
        const newSet = new Set(selectedBooks);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedBooks(newSet);
    };

    const handleBookClick = (id) => {
        if (isSelectionMode) toggleSelection(id);
        else navigate(`/read/${id}`);
    };

    const handleFolderClick = (folder) => {
        if (isSelectionMode) return;
        // Use navigate to PUSH to history stack (not replace), so back gesture works correctly
        navigate(`?folder=${folder.id}`);
        // Reset selection if any (though usually disabled in standard nav, good to be safe)
        if (isSelectionMode) {
            setIsSelectionMode(false);
            setSelectedBooks(new Set());
        }
    };

    const handleCreateFolder = async () => {
        if (!folderName.trim()) return;
        try {
            const res = await fetch('/api/books/bookshelf/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: folderName }),
                credentials: 'include'
            });
            if (res.ok) {
                const newFolder = await res.json();

                if (isMergeMode && selectedBooks.size > 0) {
                    handleBatchMove(newFolder.id);
                }

                setFolderName('');
                setShowFolderDialog(false);
                setIsMergeMode(false);
                fetchBooks();
            }
        } catch (e) { console.error(e); }
    };

    const handleBatchMove = async (folderId) => {
        try {
            const res = await fetch('/api/books/bookshelf/move', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookIds: Array.from(selectedBooks), folderId }),
                credentials: 'include'
            });
            if (res.ok) {
                exitSelectionMode();
                fetchBooks();
            }
        } catch (e) { console.error(e); }
    };



    const deleteFolder = async (id) => {
        try {
            const res = await fetch(`/api/books/bookshelf/folders/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) fetchBooks();
        } catch (e) { console.error(e); }
    };

    const renameFolder = async () => {
        if (!renameValue.trim() || !renameTarget) return;
        try {
            const res = await fetch(`/api/books/bookshelf/folders/${renameTarget.id}/rename`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: renameValue }),
                credentials: 'include'
            });
            if (res.ok) {
                fetchBooks();
                setShowRenameDialog(false);
                setRenameTarget(null);
                setRenameValue('');
            }
        } catch (e) { console.error(e); }
    };

    const deleteSelected = () => {
        setDeleteConfirmation({ type: 'batch', count: selectedBooks.size });
    };

    const handleConfirmDelete = async () => {
        const { type } = deleteConfirmation;

        if (type === 'folder') {
            await deleteFolder(deleteConfirmation.id);
        } else if (type === 'batch') {
            // Optimistic UI Update: Immediately remove books from local state
            const removedIds = new Set(selectedBooks);
            setBooks(prev => {
                const updated = prev.filter(b => !removedIds.has(b.id));
                sessionStorage.setItem('library_books_cache', JSON.stringify(updated));
                return updated;
            });

            // 后台静默请求
            fetch('/api/books/bookshelf/batch', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookIds: Array.from(selectedBooks) }),
                credentials: 'include'
            }).catch(e => console.error(e));

            setSelectedBooks(new Set());
            setIsSelectionMode(false);
        }

        setDeleteConfirmation(null);
    };

    const handleCoverSuccess = (bookId, newCover) => {
        // Update local state
        setBooks(prev => prev.map(b =>
            b.id === bookId ? { ...b, cover: newCover ? (newCover + '?t=' + Date.now()) : null } : b
        ));

        // Update cache
        try {
            const cached = sessionStorage.getItem('library_books_cache');
            if (cached) {
                const currentBooks = JSON.parse(cached);
                const updatedBooks = currentBooks.map(b =>
                    b.id === bookId ? { ...b, cover: newCover ? (newCover + '?t=' + Date.now()) : null } : b
                );
                sessionStorage.setItem('library_books_cache', JSON.stringify(updatedBooks));
            }
        } catch (e) { }
    };

    if (loading) {
        return (
            <div className={`flex items-center justify-center h-screen ${colors.bg}`}>
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className={`min-h-full pb-20 ${colors.bg} transition-colors duration-200 ${isEInk ? 'reader-theme-e-ink' : ''}`}>
            {/* Header */}
            <div className={`px-4 py-3 flex items-center justify-between sticky top-0 z-10 ${colors.headerBg}`} style={{ height: '64px' }}>
                {isSearchOpen ? (
                    <div ref={searchRef} className="flex-1 animate-in fade-in zoom-in-95 duration-200">
                        <div className="relative">
                            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${colors.textSub}`} />
                            <input
                                autoFocus
                                type="text"
                                placeholder="搜索书架..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className={`w-full pl-10 pr-4 py-2.5 border-none rounded-full text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 ${colors.inputBg} ${colors.textMain} placeholder:${isDark ? 'text-gray-600' : 'text-gray-400'}`}
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        {isSelectionMode ? (
                            <div className="flex items-center gap-3 w-full">
                                {/* Cancel Selection (Side Back) */}
                                <button
                                    onClick={exitSelectionMode}
                                    className={`p-2 -ml-2 rounded-full transition-all active:scale-95 ${colors.iconBtn}`}
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                </button>

                                <span className={`font-bold text-lg ${colors.textMain}`}>已选 {selectedBooks.size} 项</span>
                                <div className="flex-1"></div>

                                <div className="flex items-center gap-3">
                                    {/* Select All */}
                                    <button
                                        onClick={() => {
                                            // Handle Select All logic
                                            // Determine items to select: if searching or inside folder, only select those
                                            let currentItems = books;
                                            if (currentFolder) {
                                                currentItems = books.filter(b => b.bookshelf_folder_id === currentFolder.id);
                                            } else {
                                                // Root: books with no folder
                                                currentItems = books.filter(b => !b.bookshelf_folder_id);
                                            }
                                            // Filter by search if active (though search is hidden in this mode usually, but check)
                                            // Actually search replaces header, so we can't be in search AND selection mode easily with this UI.

                                            const allIds = currentItems.map(b => b.id);
                                            const allSelected = allIds.every(id => selectedBooks.has(id));

                                            const newSet = new Set(selectedBooks);
                                            if (allSelected) {
                                                allIds.forEach(id => newSet.delete(id));
                                            } else {
                                                allIds.forEach(id => newSet.add(id));
                                            }
                                            setSelectedBooks(newSet);
                                        }}
                                        className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}
                                    >
                                        {(() => {
                                            // Check status logic inline
                                            let currentItems = books;
                                            if (currentFolder) currentItems = books.filter(b => b.bookshelf_folder_id === currentFolder.id);
                                            else currentItems = books.filter(b => !b.bookshelf_folder_id);

                                            if (currentItems.length > 0 && currentItems.every(b => selectedBooks.has(b.id))) {
                                                return <div className="w-5 h-5 flex items-center justify-center text-blue-500"><Check strokeWidth={3} className="w-4 h-4" /></div>; // Using existing icons or CheckSquare if imported
                                            }
                                            return <div className={`w-5 h-5 border-2 rounded-md ${isDark ? 'border-gray-500' : 'border-gray-400'}`}></div>;
                                        })()}
                                    </button>

                                    <button
                                        onClick={() => { setFolderName(''); setIsMergeMode(true); setShowFolderDialog(true); }}
                                        disabled={selectedBooks.size === 0}
                                        className={`p-2 text-blue-500 rounded-full shadow-sm disabled:opacity-50 transition-all active:scale-95 ${isDark ? 'bg-[#2C2C2E]' : 'bg-white'}`}
                                        title="移动到文件夹"
                                    >
                                        <FolderInput className="w-5 h-5" />
                                    </button>
                                    <button onClick={deleteSelected} disabled={selectedBooks.size === 0} className={`p-2 text-red-500 rounded-full shadow-sm disabled:opacity-50 transition-all active:scale-95 ${isDark ? 'bg-[#2C2C2E]' : 'bg-white'}`}>
                                        <Trash2 className="w-5 h-5" />
                                    </button>

                                    {/* Right X Cancel */}
                                    <button onClick={exitSelectionMode} className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}>
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-2">
                                    {currentFolder && (
                                        <button
                                            onClick={() => navigate('/', { replace: true })}
                                            className={`p-2 -ml-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}
                                        >
                                            <ArrowLeft className="w-5 h-5" />
                                        </button>
                                    )}
                                    <span className={`${currentFolder ? 'text-xl' : 'text-[28px]'} font-bold ${currentFolder ? 'truncate' : 'tracking-tight'} ${colors.textMain}`}>
                                        {currentFolder ? currentFolder.name : '书架'}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 ml-auto">
                                    {!currentFolder && (
                                        <button
                                            onClick={() => { setFolderName(''); setIsMergeMode(false); setShowFolderDialog(true); }}
                                            className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}
                                            title="新建文件夹"
                                        >
                                            <FolderPlus className="w-5 h-5" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setIsSearchOpen(true)}
                                        className={`p-2 rounded-full shadow-sm transition-all active:scale-95 ${colors.iconBtn}`}
                                    >
                                        <Search className="w-5 h-5" />
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Content Area */}
            <div className="px-4 pt-2">
                {books.length === 0 && folders.length === 0 ? (
                    <div className={`${colors.emptyCard} rounded-[20px] p-8 text-center shadow-sm flex flex-col items-center justify-center min-h-[50vh]`}>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isDark ? 'bg-[#2C2C2E]' : 'bg-gray-50'}`}>
                            <Book className={`w-8 h-8 ${colors.emptyText}`} />
                        </div>
                        <p className={`font-medium mb-1 ${colors.textMain}`}>书架是空的</p>
                        <p className={`text-sm mb-6 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>去探索一些有趣的书籍吧</p>
                        <button onClick={() => navigate('/library')} className={`px-6 py-2.5 text-sm font-medium rounded-full active:scale-95 transition-transform ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>
                            前往发现
                        </button>
                    </div>
                ) : (
                    <div className="pb-4">
                        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-3 md:gap-4">
                            {/* Folders (Only in Root) */}
                            {!currentFolder && !searchQuery && folders.map(folder => {
                                const folderBooks = books.filter(b => b.bookshelf_folder_id === folder.id).slice(0, 4);
                                return (
                                    <div
                                        key={`folder-${folder.id}`}
                                        className="group relative flex flex-col gap-2 cursor-pointer active:scale-95 transition-transform duration-200"
                                        onClick={() => handleFolderClick(folder)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            setActionFolder(folder);
                                        }}
                                    >
                                        <div className={`aspect-[2/3] shadow-md rounded-xl border relative overflow-hidden ${isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                                            {folderBooks.length > 0 ? (
                                                <div className="absolute inset-0 p-2 grid grid-cols-2 grid-rows-2 gap-1">
                                                    {folderBooks.map(b => (
                                                        <div key={b.id} className="w-full h-full overflow-hidden rounded-sm relative bg-black/5 dark:bg-white/5">
                                                            {b.cover ? (
                                                                <img src={getCoverUrl(b.cover)} className="w-full h-full object-cover" alt="" />
                                                            ) : (
                                                                <div className={`w-full h-full flex items-center justify-center text-[5px] text-center p-0.5 leading-tight ${coverColors.text}`}
                                                                    style={{ backgroundColor: coverColors.bg }}
                                                                >
                                                                    {b.title.replace(/\.(txt|epub|mobi|azw3|pdf|md|fb2|cbz|cbr)$/i, '').slice(0, 4)}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>空</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className={`text-center text-xs font-medium truncate px-1 ${colors.textMain}`}>{folder.name}</div>
                                    </div>
                                );
                            })}

                            {/* Books */}
                            {books
                                .filter(book => {
                                    if (searchQuery) return book.title.toLowerCase().includes(searchQuery.toLowerCase());
                                    if (currentFolder) return book.bookshelf_folder_id === currentFolder.id;
                                    return !book.bookshelf_folder_id; // Root books
                                })
                                .map(book => {
                                    const isPublicBook = book.is_public == 1 || book.lib_is_public == 1;
                                    const canEditCover = !isPublicBook || user.role === 'admin';
                                    return (
                                        <BookItem
                                            key={book.id}
                                            book={book}
                                            isSelectionMode={isSelectionMode}
                                            isSelected={selectedBooks.has(book.id)}
                                            onClick={() => handleBookClick(book.id)}
                                            onLongPress={() => {
                                                if (!isSelectionMode) {
                                                    enterSelectionMode();
                                                    toggleSelection(book.id);
                                                } else {
                                                    toggleSelection(book.id);
                                                }
                                            }}
                                            colors={colors}
                                            coverColors={coverColors}
                                            getCoverUrl={getCoverUrl}
                                            onEditCover={canEditCover ? (book) => setEditingBook(book) : null}
                                        />
                                    );
                                })}
                        </div>
                    </div>
                )}
            </div>

            {/* Delete Confirmation Dialog */}
            {deleteConfirmation && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${isDark ? 'bg-[#1C1C1E]' : 'bg-white'} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-2 ${colors.textMain}`}>
                            移出书架
                        </h3>
                        <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {deleteConfirmation.type === 'folder' ? (
                                <>
                                    确定要删除文件夹 "{deleteConfirmation.name}" 吗？
                                    <br />
                                    <span className="opacity-80 mt-1 block text-red-500">文件夹内的所有书籍也将移出书架</span>
                                    <span className="opacity-60 text-xs mt-1 block">原文件不会被删除</span>
                                </>
                            ) : (
                                <>
                                    确定要将这 {deleteConfirmation.count} 本书移出书架吗？
                                    <br />
                                    <span className="opacity-80 mt-1 block">移出书架，不会删除原文件</span>
                                </>
                            )}
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
                                移出
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Folder Dialog */}
            {showFolderDialog && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${isDark ? 'bg-[#1C1C1E]' : 'bg-white'} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-4 ${colors.textMain}`}>
                            {isMergeMode ? '移动到文件夹' : '新建文件夹'}
                        </h3>

                        {isMergeMode ? (
                            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                                {currentFolder && (
                                    <button
                                        onClick={() => { handleBatchMove(null); setShowFolderDialog(false); }}
                                        className={`w-full text-left px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors ${isDark ? 'border-gray-800 hover:bg-[#2C2C2E]' : 'border-gray-100 hover:bg-gray-50'}`}
                                    >
                                        <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}><Book className={`w-4 h-4 ${colors.textSub}`} /></div>
                                        <span className={colors.textMain}>根目录</span>
                                    </button>
                                )}
                                {folders.map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => { handleBatchMove(f.id); setShowFolderDialog(false); }}
                                        className={`w-full text-left px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors ${isDark ? 'border-gray-800 hover:bg-[#2C2C2E]' : 'border-gray-100 hover:bg-gray-50'}`}
                                    >
                                        <div className={`p-2 rounded-lg ${isDark ? 'bg-blue-900/30' : 'bg-blue-50'}`}><Folder className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-500'}`} /></div>
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
                                            value={folderName}
                                            onChange={(e) => setFolderName(e.target.value)}
                                            className={`w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20 ${colors.inputBg} ${colors.textMain} ${isDark ? 'border-transparent' : 'border-gray-100'}`}
                                        />
                                        <button
                                            onClick={async () => {
                                                if (!folderName.trim()) return;
                                                await handleCreateFolder();
                                            }}
                                            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
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
                                    autoFocus
                                    type="text"
                                    placeholder="文件夹名称"
                                    value={folderName}
                                    onChange={(e) => setFolderName(e.target.value)}
                                    className={`w-full px-4 py-3 rounded-xl mb-6 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 ${isDark ? 'bg-[#2C2C2E] text-white' : 'bg-gray-100 text-gray-900'}`}
                                />
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowFolderDialog(false)}
                                        className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={handleCreateFolder}
                                        disabled={!folderName.trim()}
                                        className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'} disabled:opacity-50`}
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
                    <div className={`${isDark ? 'bg-[#1C1C1E]' : 'bg-white'} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-4 ${colors.textMain}`}>重命名</h3>
                        <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className={`w-full px-4 py-3 rounded-xl mb-6 text-sm outline-none focus:ring-2 focus:ring-blue-500/50 ${isDark ? 'bg-[#2C2C2E] text-white' : 'bg-gray-100 text-gray-900'}`}
                        />
                        <div className="flex gap-3">
                            <button onClick={() => setShowRenameDialog(false)} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>取消</button>
                            <button onClick={renameFolder} disabled={!renameValue.trim()} className={`flex-1 py-3 rounded-xl font-medium bg-blue-600 text-white shadow-lg shadow-blue-500/30 disabled:opacity-50`}>确定</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Folder Action Sheet */}
            {actionFolder && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm" onClick={() => setActionFolder(null)}>
                    <div className={`${isDark ? 'bg-[#1C1C1E]' : 'bg-white'} w-full sm:w-80 rounded-t-2xl sm:rounded-2xl overflow-hidden p-2 space-y-1 animate-in slide-in-from-bottom-10`} onClick={e => e.stopPropagation()}>
                        <div className={`px-4 py-3 text-sm font-medium text-center border-b mb-1 truncate ${colors.textSub} ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
                            {actionFolder.name}
                        </div>

                        <button
                            onClick={() => {
                                setRenameTarget(actionFolder);
                                setRenameValue(actionFolder.name);
                                setShowRenameDialog(true);
                                setActionFolder(null);
                            }}
                            className={`w-full py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${isDark ? 'active:bg-[#2C2C2E] text-white' : 'active:bg-gray-50 text-gray-900'}`}
                        >
                            <Edit2 className="w-5 h-5 text-blue-500" /> 重命名
                        </button>

                        <button
                            onClick={() => {
                                setDeleteConfirmation({ type: 'folder', id: actionFolder.id, name: actionFolder.name });
                                setActionFolder(null);
                            }}
                            className={`w-full py-3.5 rounded-xl font-medium flex items-center justify-center gap-2 text-red-500 transition-colors ${isDark ? 'active:bg-[#2C2C2E]' : 'active:bg-gray-50'}`}
                        >
                            <Trash2 className="w-5 h-5" /> 删除
                        </button>

                        <button
                            onClick={() => setActionFolder(null)}
                            className={`w-full py-3.5 rounded-xl font-medium mt-2 ${isDark ? 'text-gray-400 active:bg-[#2C2C2E]' : 'text-gray-500 active:bg-gray-50'}`}
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}

            <CoverEditorDialog
                isOpen={!!editingBook}
                onClose={() => setEditingBook(null)}
                book={editingBook}
                onSuccess={handleCoverSuccess}
                isDark={isDark}
                coverColors={coverColors} // Pass coverColors
            />
        </div>
    );
};

export default Bookshelf;
