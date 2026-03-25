import React, { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Search, Bookmark, Settings, Moon, List,
    ChevronLeft, ChevronRight, X, Loader2, Plus,
    Check, Trash2, Edit2, Upload, Minus, AlignJustify,
    MoveVertical, MoveHorizontal, ChevronUp, ChevronDown,
    Maximize, Minimize
} from 'lucide-react';
import { useIsFnOSMobile } from '../hooks/useIsFnOSMobile';
import { showToast } from './Toast';
import { Document, Page, pdfjs } from 'react-pdf';
import { getLoadedCustomFontNames, cacheFont, registerFont, removeCachedFont, getCachedFonts, downloadFontOnDemand, getServerFontList } from '../utils/fontCache';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import useAuth from '../hooks/useAuth';
import { useReadingTime } from '../hooks/useReadingTime';
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api';
import { getAbsoluteUrl } from '../utils/patchFetch';
import ImageReader from './ImageReader';
import { KeepAwake } from '@capacitor-community/keep-awake';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
).toString();

// 添加防抖钩子
function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

const Reader = () => {
    const { bookId } = useParams();
    const navigate = useNavigate();
    const isFnOSMobile = useIsFnOSMobile();

    // --- 核心：使用 Ref 追踪最新状态，解决事件监听闭包问题 ---
    const stateRef = useRef({
        chapters: [],
        currentChapterIndex: 0,
        loading: false,
        loadedArticles: [],
        bookFormat: 'txt',
        viewMode: 'scroll',
        chapterContentCache: new Map() // index -> { content, title }
    });

    // --- State ---
    const [bookTitle, setBookTitle] = useState('');
    const [chapters, setChapters] = useState([]);
    const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
    const [loadedArticles, setLoadedArticles] = useState([]);
    const [bookFormat, setBookFormat] = useState('txt');
    const [inBookshelf, setInBookshelf] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // 同步 State 到 Ref
    useEffect(() => {
        stateRef.current.chapters = chapters;
        stateRef.current.currentChapterIndex = currentChapterIndex;
        stateRef.current.loadedArticles = loadedArticles;
        stateRef.current.bookFormat = bookFormat;
    }, [chapters, currentChapterIndex, loadedArticles, bookFormat]);

    // PDF State
    const [numPages, setNumPages] = useState(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [pdfScale, setPdfScale] = useState(1.0);

    // UI State
    const [loading, setLoading] = useState(true);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [loadingMessage, setLoadingMessage] = useState('准备加载...');
    const [readerError, setReaderError] = useState('');
    const [showControls, setShowControls] = useState(false);
    const [activePanel, setActivePanel] = useState(null);
    const [sidebarTab, setSidebarTab] = useState('toc');
    const [bookmarks, setBookmarks] = useState([]);
    const [readingProgress, setReadingProgress] = useState(0);
    const [showFontSpacingModal, setShowFontSpacingModal] = useState(false);
    const [isInitialRestoring, setIsInitialRestoring] = useState(true); // 首次加载恢复位置期间隐藏内容
    const [titleHidden, setTitleHidden] = useState(() => localStorage.getItem('reader_titleHidden') === 'true'); // PC端标题隐藏状态
    const [currentTime, setCurrentTime] = useState('');

    // Search State
    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
    const [totalMatches, setTotalMatches] = useState(0);
    const [searchBuilt, setSearchBuilt] = useState(false);
    const [searchBuilding, setSearchBuilding] = useState(false);
    const [searchChapterMatchCounts, setSearchChapterMatchCounts] = useState([]);
    const [searchOffsets, setSearchOffsets] = useState([]);

    // Bookmarks UI State
    const [bookmarkToDelete, setBookmarkToDelete] = useState(null);
    const [bookmarkSort, setBookmarkSort] = useState('time'); // 'time' | 'location'

    // Notes & Highlights State
    const [notes, setNotes] = useState([]);
    const [selection, setSelection] = useState(null);
    const [showNoteInput, setShowNoteInput] = useState(false);
    const [noteInputValue, setNoteInputValue] = useState('');
    const [showHighlightOptions, setShowHighlightOptions] = useState(false);
    const [selectedNote, setSelectedNote] = useState(null); // For viewing note content
    const [activeNoteStyle, setActiveNoteStyle] = useState('highlight'); // highlight, underline, wavy
    const [clickedHighlight, setClickedHighlight] = useState(null); // { note, rect }
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteConfirmData, setDeleteConfirmData] = useState({ id: null, type: 'note' }); // type: 'note' | 'highlight'
    const [visualViewportStyle, setVisualViewportStyle] = useState({});

    // Mobile Keyboard handling
    useEffect(() => {
        if (!showNoteInput) return;

        const handleResize = () => {
            if (window.visualViewport) {
                setVisualViewportStyle({
                    height: `${window.visualViewport.height}px`,
                    top: `${window.visualViewport.offsetTop}px`,
                    position: 'fixed',
                    left: 0,
                    width: '100%',
                    bottom: 'auto'
                });
            } else {
                setVisualViewportStyle({
                    height: `${window.innerHeight}px`,
                    top: '0px',
                    position: 'fixed',
                    left: 0,
                    width: '100%',
                    bottom: 'auto'
                });
            }
        };

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleResize);
            window.visualViewport.addEventListener('scroll', handleResize);
        }
        window.addEventListener('resize', handleResize);
        handleResize(); // Initial set

        return () => {
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', handleResize);
                window.visualViewport.removeEventListener('scroll', handleResize);
            }
            window.removeEventListener('resize', handleResize);
        };
    }, [showNoteInput]);

    // --- Text Selection & Notes Logic ---
    useEffect(() => {
        // Disable native selection context menu on mobile to use our custom bubble
        const handleContextMenu = (e) => {
            const ua = navigator.userAgent.toLowerCase();
            const isMobile = /iphone|ipad|ipod|android|mobile/.test(ua);
            // 只要是移动端设备，都禁用原生右键菜单（长按菜单），防止与自定义气泡冲突
            if (isMobile || isFnOSMobile) {
                e.preventDefault();
            }
        };
        document.addEventListener('contextmenu', handleContextMenu);
        return () => document.removeEventListener('contextmenu', handleContextMenu);
    }, [isFnOSMobile]);

    // Keep Screen Awake
    useEffect(() => {
        const keepScreenOn = async () => {
            try {
                await KeepAwake.keepAwake();
            } catch (err) {
                console.warn('KeepAwake not supported', err);
            }
        };

        const allowScreenOff = async () => {
            try {
                await KeepAwake.allowSleep();
            } catch (err) {
                console.warn('KeepAwake not supported', err);
            }
        };

        keepScreenOn();
        return () => {
            allowScreenOff();
        };
    }, []);

    // Settings
    // 设备类型检测：mobile | desktop
    const deviceType = useMemo(() => {
        const ua = navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod|android|mobile/.test(ua) ? 'mobile' : 'desktop';
    }, []);

    // 设置状态 - 初始值使用 localStorage 缓存或默认值
    const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('reader_fontSize')) || (deviceType === 'mobile' ? 18 : 20));
    const [lineHeight, setLineHeight] = useState(() => parseFloat(localStorage.getItem('reader_lineHeight')) || 2.0);
    const [marginH, setMarginH] = useState(() => parseInt(localStorage.getItem('reader_marginH')) || (deviceType === 'mobile' ? 20 : 40));
    const [marginV, setMarginV] = useState(() => parseInt(localStorage.getItem('reader_marginV')) || (deviceType === 'mobile' ? 40 : 60));
    const [theme, setTheme] = useState(() => localStorage.getItem('reader_theme') || 'light');
    const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('reader_fontFamily') || 'sans');
    const [textAlign, setTextAlign] = useState(() => localStorage.getItem('reader_textAlign') || 'justify');
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('reader_viewMode') || 'scroll');
    const [customFonts, setCustomFonts] = useState([]);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [serverFonts, setServerFonts] = useState([]);
    const [showFontManager, setShowFontManager] = useState(false);
    const [fontToRename, setFontToRename] = useState(null);
    const [newFontName, setNewFontName] = useState('');
    const [showRemoveDialog, setShowRemoveDialog] = useState(false);
    const isDark = theme === 'dark';

    const contentRef = useRef(null);
    const fontInputRef = useRef(null);
    const progressRef = useRef({ index: 0, chapterPercent: 0, globalPercent: 0 });
    const saveTimeoutRef = useRef(null);
    const isRestoringRef = useRef(false);
    const pendingScrollRef = useRef(null);
    const activeChapterRef = useRef(null);
    const isTouchingRef = useRef(false);
    const scrollTimeoutRef = useRef(null);
    const restoreSnapSuppressUntilRef = useRef(0);

    // 翻页模式：轮转插槽架构 (Rotating Slot Architecture)
    // 3个固定插槽，轮流扮演 Current, Next, Prev 角色
    const [pageSlots, setPageSlots] = useState([null, null, null]); // Array<ChapterData>
    const [activeSlotId, setActiveSlotId] = useState(0); // 0, 1, 2

    // Slot DOM Refs
    const slotRefs = useRef([]);

    // Refs for chapter navigation functions (to avoid stale closures in keyboard handlers)
    const prevChapterRef = useRef(null);
    const nextChapterRef = useRef(null);

    // Helper to get roles based on activeSlotId
    // slotIndex -> 'current' | 'next' | 'prev'

    // --- Text Selection & Notes Logic ---
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token || !bookId) return;
        apiGet(`/api/notes/${bookId}`)
            .then(res => res.json())
            .then(data => setNotes(data))
            .catch(console.error);
    }, [bookId]);

    useEffect(() => {
        const handleSelectionChange = () => {
            if (showNoteInput) return; // Don't update if input is open

            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                setSelection(null);
                return;
            }

            const text = sel.toString().trim();
            if (!text) return;

            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            if (rect.width === 0 || rect.height === 0) return;

            // Reset sub-menu state when new selection occurs
            setShowHighlightOptions(false);

            // Only show if selection is inside reader content (simple heuristic)
            if (rect.top > 50 && rect.bottom < window.innerHeight - 50) {
                // Check if selection is inside a highlight or contains highlights
                let isInsideHighlight = false;

                // Check ancestors
                let curr = range.commonAncestorContainer;
                while (curr && curr.nodeType === 3) curr = curr.parentNode;

                while (curr && curr !== document.body) {
                    if (curr.classList && curr.classList.contains('user-highlight')) {
                        isInsideHighlight = true;
                        break;
                    }
                    curr = curr.parentNode;
                }

                // Check if selection contains highlights
                if (!isInsideHighlight) {
                    const fragment = range.cloneContents();
                    if (fragment.querySelector('.user-highlight')) {
                        isInsideHighlight = true;
                    }
                }

                // Calculate occurrence index for unique identification
                let rangeStart = 0;
                try {
                    let container = range.startContainer;
                    // Find closest chapter article
                    while (container && (!container.classList || !container.classList.contains('chapter-article'))) {
                        if (!container.parentElement) break;
                        container = container.parentElement;
                    }

                    if (container && container.classList.contains('chapter-article')) {
                        const preRange = document.createRange();
                        preRange.selectNodeContents(container);
                        preRange.setEnd(range.startContainer, range.startOffset);
                        const preText = preRange.toString();

                        // Count occurrences of text in preText
                        const safeText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(safeText, 'g');
                        const matches = preText.match(regex);
                        rangeStart = matches ? matches.length : 0;
                    }
                } catch (e) {
                    console.warn('Failed to calculate selection index', e);
                }

                setSelection({
                    text,
                    rangeStart,
                    isInsideHighlight,
                    rect: {
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                        right: rect.right
                    }
                });
            }
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, [showNoteInput]);

    const handleCopy = async (e) => {
        e.stopPropagation();
        if (!selection || !selection.text) return;

        const text = selection.text;
        let success = false;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                success = true;
            } else {
                throw new Error('Clipboard API unavailable');
            }
        } catch (err) {
            console.warn('Clipboard API failed, falling back to execCommand', err);
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                success = document.execCommand('copy');
                document.body.removeChild(textArea);
            } catch (fallbackErr) {
                console.error('Fallback copy failed', fallbackErr);
            }
        }

        if (success) {
            showToast.success('已复制');
            window.getSelection().removeAllRanges();
            setSelection(null);
        } else {
            showToast.error('复制失败');
        }
    };

    const handleHighlight = (style = 'highlight') => {
        if (!selection) return;
        saveNote(selection.text, '', style, true, selection.rangeStart);
    };

    const handleNote = (e) => {
        e.stopPropagation();
        setShowNoteInput(true);
    };

    const updateNoteStyle = async (id, newStyle) => {
        try {
            const res = await apiPut(`/api/notes/${id}`, { style: newStyle });
            if (res.ok) {
                setNotes(prev => prev.map(n => n.id === id ? { ...n, style: newStyle } : n));
                showToast.success('样式已更新');
            }
        } catch (e) {
            showToast.error('更新失败');
        }
    };

    const saveNote = async (text, content, style, shouldClear = true, rangeStart = 0) => {
        try {
            const res = await apiPost('/api/notes', {
                bookId,
                chapterIndex: currentChapterIndex,
                textContent: text,
                rangeStart: rangeStart,
                noteContent: content,
                style,
                color: style === 'highlight' ? 'yellow' : 'blue'
            });
            if (res.ok) {
                const responseData = await res.json();
                // Convert camelCase to snake_case for frontend consistency
                const newNote = {
                    ...responseData,
                    chapter_index: responseData.chapterIndex,
                    text_content: responseData.textContent,
                    note_content: responseData.noteContent,
                    range_start: responseData.rangeStart
                };

                setNotes(prev => {
                    return [...prev, newNote];
                });

                if (content) {
                    showToast.success('笔记已保存');
                    setShowNoteInput(false);
                    setNoteInputValue('');
                } else {
                    // Just highlight
                }

                if (shouldClear) {
                    window.getSelection().removeAllRanges();
                    setSelection(null);
                }
            }
        } catch (e) {
            showToast.error('保存失败');
        }
    };

    // 时钟更新逻辑
    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            setCurrentTime(timeString);
        };
        updateTime(); // Initial call
        const timer = setInterval(updateTime, 1000 * 60); // Update every minute
        return () => clearInterval(timer);
    }, []);

    const getSlotRole = (slotIndex, activeIndex) => {
        if (slotIndex === activeIndex) return 'current';
        if (slotIndex === (activeIndex + 1) % 3) return 'next';
        return 'prev';
    };

    // 监听插槽内容变化，执行预滚动 (Pre-scroll)
    useLayoutEffect(() => {
        const mode = stateRef.current.viewMode;
        // 仅在翻页模式下生效
        if (mode !== 'h-page' && mode !== 'instant' && mode !== 'v-page') return;

        pageSlots.forEach((slotData, i) => {
            if (!slotData) return;
            const role = getSlotRole(i, activeSlotId);
            const el = slotRefs.current[i];
            if (!el) return;

            // 如果是 Next 角色，必须强制滚到顶部 (Top/Left)
            if (role === 'next') {
                requestAnimationFrame(() => {
                    el.scrollTop = 0;
                    el.scrollLeft = 0;
                });
            }
            // 如果是 Prev 角色，必须强制滚到底部 (Bottom/Right)
            else if (role === 'prev') {
                requestAnimationFrame(() => {
                    if (mode === 'h-page' || mode === 'instant') {
                        // Horizontal: Scroll to rightmost (last page)
                        const pageStep = el.getBoundingClientRect().width;
                        const maxScroll = el.scrollWidth - pageStep;
                        el.scrollLeft = maxScroll;
                    } else {
                        el.scrollTop = el.scrollHeight;
                    }
                });
            }
        });
    }, [pageSlots, activeSlotId]); // 当插槽内容更新或角色轮转时触发

    // 同步其他配置到 Ref
    useEffect(() => { stateRef.current.viewMode = viewMode; }, [viewMode]);
    useEffect(() => { stateRef.current.loading = loading; }, [loading]);

    // 打开字体管理弹窗时刷新字体列表（确保获取到最新的同步字体）
    useEffect(() => {
        if (showFontManager) {
            getLoadedCustomFontNames().then(names => {
                if (names.length > 0) {
                    setCustomFonts(names);
                }
            });
        }
    }, [showFontManager]);

    // Sync with global theme modes (Only on initial mount, not continuously)
    useEffect(() => {
        const globalTheme = localStorage.getItem('app_theme');
        const savedReaderTheme = localStorage.getItem('reader_theme') || 'light';

        // High Priority: Global Dark/E-Ink modes force specific reader themes
        if (globalTheme === 'e-ink') {
            if (theme !== 'e_ink') setTheme('e_ink');
        }
        else if (globalTheme === 'dark') {
            if (theme !== 'dark') setTheme('dark');
        }
        // Low Priority: Global Light mode allows custom reader themes - use saved preference
        else {
            // Only override if currently showing a forced theme (dark/e_ink) but global is Light
            const isCurrentForced = theme === 'dark' || theme === 'e_ink';
            if (isCurrentForced) {
                const isSavedForced = savedReaderTheme === 'dark' || savedReaderTheme === 'e_ink';
                const target = isSavedForced ? 'light' : savedReaderTheme;
                setTheme(target);
            }
        }
        // NOTE: Removed polling. Theme sync now only happens on mount.
        // User's manual theme selection within the reader will now persist.
    }, []); // Empty dependency array - only run once on mount

    // 目录打开时自动定位到当前章节
    useEffect(() => {
        if (activePanel === 'toc' && activeChapterRef.current) {
            activeChapterRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
    }, [activePanel, currentChapterIndex]);

    // Handle popstate for history navigation (Fixes back button logic)
    useEffect(() => {
        const handlePopState = (event) => {
            const state = event.state || {};
            if (!state.panel && activePanel) {
                setActivePanel(null);
            }
            if (!state.search && showSearch) {
                setShowSearch(false);
                setShowControls(false);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [activePanel, showSearch]);

    // PC端键盘控制 + 移动端音量键翻页
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ctrl+Shift+1: 切换网页标题（隐藏书名）
            if (e.ctrlKey && e.shiftKey && (e.key === '1' || e.key === '!')) {
                e.preventDefault();
                setTitleHidden(prev => {
                    const newHidden = !prev;
                    document.title = newHidden ? '轻阅读' : (bookTitle || '轻阅读');
                    localStorage.setItem('reader_titleHidden', String(newHidden));
                    return newHidden;
                });
                return;
            }

            // 忽略输入框中的按键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            // 忽略菜单打开时的按键
            if (activePanel || showControls || showSearch) return;

            const container = contentRef.current;
            if (!container) return;

            const { innerWidth, innerHeight } = window;
            const mode = stateRef.current.viewMode;

            // 通用翻页函数
            const goToPrevPage = () => {
                if (mode === 'h-page' || mode === 'instant') {
                    const scrollBehavior = mode === 'instant' ? 'instant' : 'smooth';
                    const pageStep = innerWidth;
                    const currentPage = Math.round(container.scrollLeft / pageStep);
                    if (currentPage <= 0) {
                        prevChapterRef.current?.(true);
                    } else {
                        container.scrollTo({ left: (currentPage - 1) * pageStep, behavior: scrollBehavior });
                    }
                } else {
                    // scroll 或 v-page 模式
                    const scrollAmount = innerHeight - 40;
                    if (container.scrollTop <= 5) {
                        prevChapterRef.current?.(true);
                    } else {
                        container.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
                    }
                }
            };

            const goToNextPage = () => {
                if (mode === 'h-page' || mode === 'instant') {
                    const scrollBehavior = mode === 'instant' ? 'instant' : 'smooth';
                    const pageStep = innerWidth;
                    const maxScroll = container.scrollWidth - innerWidth;
                    // 先检查当前是否已在最后一页
                    if (container.scrollLeft >= maxScroll - 5) {
                        nextChapterRef.current?.();
                    } else {
                        // 翻到下一页
                        const currentPage = Math.floor(container.scrollLeft / pageStep);
                        const targetScroll = Math.min((currentPage + 1) * pageStep, maxScroll);
                        container.scrollTo({ left: targetScroll, behavior: scrollBehavior });
                    }
                } else {
                    // scroll 或 v-page 模式
                    const scrollAmount = innerHeight - 40;
                    const maxScroll = container.scrollHeight - innerHeight;
                    if (container.scrollTop >= maxScroll - 5) {
                        nextChapterRef.current?.();
                    } else {
                        container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                    }
                }
            };

            switch (e.key) {
                // ========== 音量键翻页 (Android Chrome 支持) ==========
                case 'AudioVolumeUp':
                case 'VolumeUp':
                    e.preventDefault();
                    goToPrevPage();
                    break;

                case 'AudioVolumeDown':
                case 'VolumeDown':
                    e.preventDefault();
                    goToNextPage();
                    break;

                // ========== PageUp/PageDown 翻页 ==========
                case 'PageUp':
                    e.preventDefault();
                    goToPrevPage();
                    break;

                case 'PageDown':
                case ' ': // 空格键下一页
                    e.preventDefault();
                    goToNextPage();
                    break;

                // ========== 方向键控制 ==========
                case 'ArrowUp':
                    e.preventDefault();
                    if (mode === 'scroll') {
                        container.scrollBy({ top: -100, behavior: 'smooth' });
                    } else if (mode === 'v-page') {
                        goToPrevPage();
                    }
                    break;

                case 'ArrowDown':
                    e.preventDefault();
                    if (mode === 'scroll') {
                        container.scrollBy({ top: 100, behavior: 'smooth' });
                    } else if (mode === 'v-page') {
                        goToNextPage();
                    }
                    break;

                case 'ArrowLeft':
                    e.preventDefault();
                    if (mode === 'h-page' || mode === 'instant') {
                        goToPrevPage();
                    }
                    break;

                case 'ArrowRight':
                    e.preventDefault();
                    if (mode === 'h-page' || mode === 'instant') {
                        goToNextPage();
                    }
                    break;

                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activePanel, showControls, showSearch]);

    // 主题配置
    const themes = {
        light: { bg: 'bg-[#F9F9F9]', text: 'text-gray-800', ui: 'bg-white border-gray-100', active: 'bg-gray-100 text-black' },
        dark: { bg: 'bg-[#121212]', text: 'text-[#AAAAAA]', ui: 'bg-[#1E1E1E] border-[#2C2C2E]', active: 'bg-[#333] text-white' },
        sepia: { bg: 'bg-[#F5F2E9]', text: 'text-[#5F4B32]', ui: 'bg-[#EAE4D3] border-[#D6C6AC]', active: 'bg-[#D6C6AC] text-[#5F4B32]' },
        green: { bg: 'bg-[#C7EDCC]', text: 'text-[#004D40]', ui: 'bg-[#B4DDB9] border-[#A3CFA9]', active: 'bg-[#A3CFA9] text-[#004D40]' },
        blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', ui: 'bg-[#BBDEFB] border-[#90CAF9]', active: 'bg-[#90CAF9] text-[#0D47A1]' },
        pink: { bg: 'bg-[#FCE4EC]', text: 'text-[#880E4F]', ui: 'bg-[#F8BBD0] border-[#F48FB1]', active: 'bg-[#F48FB1] text-[#880E4F]' },
        gray: { bg: 'bg-[#ECEFF1]', text: 'text-[#37474F]', ui: 'bg-[#CFD8DC] border-[#B0BEC5]', active: 'bg-[#B0BEC5] text-[#263238]' },
        night: { bg: 'bg-[#000000]', text: 'text-[#666666]', ui: 'bg-[#111] border-[#333]', active: 'bg-[#333] text-[#888]' },
        // Compatibility for old themes
        slate: { bg: 'bg-[#1e293b]', text: 'text-[#cbd5e1]', ui: 'bg-[#0f172a] border-[#1e293b]', active: 'bg-[#1e293b] text-[#cbd5e1]' },
        warm: { bg: 'bg-[#fdf6e3]', text: 'text-[#657b83]', ui: 'bg-[#eee8d5] border-[#d3cbb7]', active: 'bg-[#d3cbb7] text-[#657b83]' },
        coffee: { bg: 'bg-[#2b2118]', text: 'text-[#a89f91]', ui: 'bg-[#201812] border-[#3c2f25]', active: 'bg-[#3c2f25] text-[#a89f91]' },
        e_ink: { bg: 'bg-[#F4F4F4]', text: 'text-black', ui: 'bg-white border-black border', active: 'bg-black text-white' },
    };

    // Safe theme fallback
    const currentTheme = themes[theme] ? theme : 'light';
    const currentUiStyle = themes[currentTheme].ui;
    const currentTextStyle = themes[currentTheme].text;
    const currentBgStyle = themes[currentTheme].bg;

    const token = localStorage.getItem('token');
    const pdfFileObj = useMemo(() => ({
        url: `/api/books/${bookId}/pdf_stream`,
        httpHeaders: { Authorization: `Bearer ${token}` },
        withCredentials: true
    }), [bookId, token]);

    // 阅读时长统计
    useReadingTime(bookId, token, theme);

    // 设置文档标题
    useEffect(() => {
        // 如果标题处于隐藏模式，不更新为书名
        if (titleHidden) return;
        if (bookTitle) document.title = bookTitle;
        return () => { document.title = '轻阅读'; };
    }, [bookTitle, titleHidden]);

    // --- Fullscreen Logic ---
    const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());

    const toggleFullscreen = useCallback(() => {
        if (isIOS) {
            setIsFullscreen(prev => !prev);
        } else {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(console.error);
            } else {
                document.exitFullscreen().catch(console.error);
            }
        }
    }, [isIOS]);

    useEffect(() => {
        if (isIOS) return; 
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, [isIOS]);

    // --- 导航处理 (修复返回无效) ---
    const handleBack = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => { });
        }
        
        if (isIOS && isFullscreen) {
             setIsFullscreen(false);
        }

        try {
            // Explicitly save progress before navigating
            const { index, scrollTop } = progressRef.current || { index: 0, scrollTop: 0 };
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

            const chapter = stateRef.current.chapters[index];
            const chapterTitle = chapter ? chapter.title : '';

            apiPost(`/api/books/${bookId}/progress`,
                { scroll_top: scrollTop, chapter_index: index, chapter_title: chapterTitle },
                { keepalive: true }
            ).catch(console.error);

            // 如果有历史记录则返回，否则回到首页
            if (window.history.length > 1) {
                navigate(-1);
            } else {
                navigate('/', { replace: true });
            }
        } catch (e) {
            console.error("Navigation failed", e);
            navigate('/', { replace: true });
        }
    };

    // --- 书签逻辑 ---
    const fetchBookmarks = async () => {
        try {
            const res = await apiGet(`/api/books/${bookId}/bookmarks`);
            if (res.ok) {
                setBookmarks(await res.json());
            }
        } catch (e) { console.error(e); }
    };

    const fetchNotes = async () => {
        try {
            const res = await apiGet(`/api/notes/${bookId}`);
            if (res.ok) {
                const data = await res.json();
                setNotes(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleDeleteRequest = (id, type) => {
        setDeleteConfirmData({ id, type });
        setShowDeleteConfirm(true);
    };

    const deleteNote = async (id, skipConfirm = false) => {
        // if (!skipConfirm && !window.confirm('确定删除这条笔记吗？')) return false;
        try {
            const res = await apiDelete(`/api/notes/${id}`);
            if (res.ok) {
                setNotes(prev => prev.filter(n => n.id !== id));
                showToast.success('已删除');
                return true;
            }
        } catch (e) {
            showToast.error('删除失败');
        }
        return false;
    };

    const addBookmark = async () => {
        const token = localStorage.getItem('token');
        try {
            const container = contentRef.current;
            const mode = stateRef.current.viewMode;
            let scrollTop = container ? container.scrollTop : 0;
            let percent = 0;
            let anchorText = null;
            let previewText = '';

            if (mode === 'scroll') {
                if (container) {
                    scrollTop = container.scrollTop;
                    percent = progressRef.current.chapterPercent || 0;

                    // -------------------------------------------------------------
                    // 修复: 使用 caretRangeFromPoint 探测视口顶部文本
                    // -------------------------------------------------------------
                    const probeY = 80; // Header(60) + margin(20)
                    const probeXs = [
                        window.innerWidth / 2, // Center
                        (stateRef.current.marginH || 20) + 40, // Left edge
                    ];

                    let range = null;
                    for (const x of probeXs) {
                        try {
                            if (document.caretRangeFromPoint) {
                                range = document.caretRangeFromPoint(x, probeY);
                            } else if (document.caretPositionFromPoint) {
                                // Firefox
                                const pos = document.caretPositionFromPoint(x, probeY);
                                if (pos) {
                                    range = document.createRange();
                                    range.setStart(pos.offsetNode, pos.offset);
                                    range.setEnd(pos.offsetNode, pos.offset);
                                }
                            }
                        } catch (e) {
                            // Ignore detection errors
                        }
                        // Check if we hit a text node
                        if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
                            break;
                        }
                    }

                    if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
                        const node = range.startContainer;
                        const offset = range.startOffset;
                        // Capture text from this offset
                        const fullText = node.textContent;
                        const textFromPoint = fullText.substring(offset).trim();

                        if (textFromPoint.length > 5) {
                            previewText = textFromPoint.substring(0, 100);
                        } else {
                            // Too short (end of line?), try appending next sibling text if usually inline
                            previewText = (textFromPoint + " " + (node.nextSibling?.textContent || "")).trim().substring(0, 100);
                        }
                        anchorText = previewText.substring(0, 30);
                    }

                    // Fallback to DOM Element Scan (Robust) if caret failed
                    if (!anchorText) {
                        const articles = Array.from(container.getElementsByClassName('chapter-article'));
                        for (const article of articles) {
                            const rect = article.getBoundingClientRect();
                            if (rect.bottom > 60) {
                                // Simple extraction
                                const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null, false);
                                let node;
                                while (node = walker.nextNode()) {
                                    const r = document.createRange(); r.selectNode(node);
                                    const nr = r.getBoundingClientRect();
                                    // Relaxed intersection check
                                    if (nr.bottom > 60 && nr.top < container.clientHeight) {
                                        if (nr.top > 40 && nr.top < 300) {
                                            previewText = node.textContent.trim().substring(0, 100);
                                            anchorText = previewText.substring(0, 30);
                                            break;
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            } else {
                // 翻页模式
                // 1. 百分比
                percent = progressRef.current.chapterPercent || 0;
                // 2. 预览文本 (尝试获取当前插槽的内容)
                const currentSlotContent = pageSlots[activeSlotId]?.content;
                if (currentSlotContent) {
                    // 简单的文本提取：移除 HTML 标签
                    const plain = currentSlotContent.replace(/<[^>]+>/g, '');
                    // 估算位置：根据百分比截取
                    const len = plain.length;
                    const startIdx = Math.floor(len * (percent / 100));
                    previewText = plain.substring(startIdx, startIdx + 100).trim();
                    anchorText = previewText.substring(0, 30);
                }
            }

            // Fallbacks
            if (!anchorText) anchorText = progressRef.current.anchorText;
            // 抓取到了 anchorText 用于定位，但在列表中只展示章节标题
            const currentChapterTitle = stateRef.current.chapters[stateRef.current.currentChapterIndex]?.title || '未知章节';
            // 列表显示的文本：章节名
            previewText = currentChapterTitle;
            // 如果需要，可以加上百分比
            // previewText = `${currentChapterTitle} (${percent}%)`;

            if (!anchorText && previewText) anchorText = previewText.substring(0, 30);

            const chapter = stateRef.current.chapters[stateRef.current.currentChapterIndex];

            const res = await apiPost(`/api/books/${bookId}/bookmarks`, {
                chapter_index: stateRef.current.currentChapterIndex,
                chapter_title: chapter?.title,
                scroll_top: scrollTop,
                text_preview: previewText, // 这里存的是展示用的文本
                chapter_percent: percent,
                anchor_text: anchorText // 这里存的是定位用的文本
            });

            if (res.ok) {
                fetchBookmarks(); // Refresh
                showToast.success('书签已添加');
            }
        } catch (e) { console.error(e); showToast.error('添加失败'); }
    };

    const confirmDeleteBookmark = async () => {
        if (!bookmarkToDelete) return;
        const id = bookmarkToDelete.id;
        try {
            await apiDelete(`/api/bookmarks/${id}`);
            setBookmarks(bookmarks.filter(b => b.id !== id));
            setBookmarkToDelete(null); // Close modal
            showToast.success('书签已删除');
        } catch (e) {
            console.error(e);
            showToast.error('删除失败');
        }
    };

    // Sort logic
    const sortedBookmarks = useMemo(() => {
        const sorted = [...bookmarks];
        if (bookmarkSort === 'time') {
            // Newest first
            return sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else {
            // Location: Chapter Index ASC -> Percent ASC
            return sorted.sort((a, b) => {
                if (a.chapter_index !== b.chapter_index) return a.chapter_index - b.chapter_index;
                return (a.chapter_percent || 0) - (b.chapter_percent || 0);
            });
        }
    }, [bookmarks, bookmarkSort]);

    // Effect to load bookmarks when panel opens
    useEffect(() => {
        if (activePanel === 'toc') {
            if (sidebarTab === 'bookmarks') fetchBookmarks();
            if (sidebarTab === 'notes') fetchNotes();
        }
    }, [activePanel, sidebarTab]);

    // --- Search Logic ---
    const escapeRegExp = (string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const openSearch = () => {
        window.history.pushState({ search: true }, '', '');
        setShowSearch(true);
        setShowControls(true);
    };

    const closeSearch = () => {
        window.history.back();
    };

    const navigateSearch = async (direction) => {
        if (totalMatches === 0) return;
        let newIndex;
        if (direction === 'next') {
            newIndex = currentMatchIndex + 1;
            if (newIndex >= totalMatches) newIndex = 0;
        } else {
            newIndex = currentMatchIndex - 1;
            if (newIndex < 0) newIndex = totalMatches - 1;
        }
        setCurrentMatchIndex(newIndex);
        await scrollToMatch(newIndex);
    };

    const findChapterForGlobalIndex = (idx) => {
        let chapterIndex = 0;
        for (let i = 0; i < searchOffsets.length; i++) {
            const start = searchOffsets[i] || 0;
            const count = searchChapterMatchCounts[i] || 0;
            if (idx >= start && idx < start + count) {
                chapterIndex = i;
                const localIndex = idx - start;
                return { chapterIndex, localIndex };
            }
        }
        return { chapterIndex: 0, localIndex: idx };
    };

    const scrollToMatch = async (index) => {
        let targetIndex = index;
        if (searchBuilt) {
            const { chapterIndex, localIndex } = findChapterForGlobalIndex(index);
            if (stateRef.current.currentChapterIndex !== chapterIndex) {
                await loadChapter(chapterIndex, false, 0, true);
                await new Promise(r => setTimeout(r, 100));
            }
            targetIndex = localIndex;
        }
        const el = document.getElementById(`search-match-${targetIndex}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    // Calculate matches effect
    useEffect(() => {
        if (!showSearch || !searchQuery) {
            setTotalMatches(0);
            return;
        }

        // Defer to allow DOM render
        const timer = setTimeout(() => {
            const matches = document.querySelectorAll('.search-match');
            if (!searchBuilt) setTotalMatches(matches.length);

            // Assign IDs dynamically for navigation
            matches.forEach((match, index) => {
                match.id = `search-match-${index}`;
            });

            if (matches.length > 0 && currentMatchIndex === -1) {
                // Find first visible match "from here"
                const container = document.querySelector('.overflow-y-auto'); // Adjust selector if needed
                if (container) {
                    const containerTop = container.scrollTop;
                    let found = 0;
                    for (let i = 0; i < matches.length; i++) {
                        if (matches[i].offsetTop >= containerTop) {
                            found = i;
                            break;
                        }
                    }
                    setCurrentMatchIndex(found);
                }
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [searchQuery, showSearch, loadedArticles]);

    const getHighlightedContent = (text, articleIndex) => {
        if (!text) return null;
        if (!searchQuery || !showSearch) return text;

        try {
            const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
            const parts = text.split(regex);

            return parts.map((part, i) =>
                part.toLowerCase() === searchQuery.toLowerCase() ?
                    <span key={i} className="search-match bg-yellow-300 text-black">{part}</span> : part
            );
        } catch (e) {
            return text;
        }
    };

    // 这里的 Search 实现比较基础，为了支持跳转，我们需要更高级的逻辑：
    // 在渲染前计算所有匹配项并分配 ID。
    // 由于 React 渲染机制，我们可以在 useEffect 中做 DOM 查询来定位。

    // 重新实现 getHighlightedContent 以支持 ID
    // 我们使用一个全局计数器 ref 在渲染周期中重置？不行，React 可能会多次调用渲染。
    // 妥协方案：只高亮，暂不支持精确跳转，或者仅支持当前可视区域跳转。
    //
    // 为了完全复刻旧版功能（支持跳转），我们需要在渲染时生成带 ID 的 span。
    // 旧版代码逻辑：
    // return parts.map((part, i) => part.toLowerCase() === searchQuery.toLowerCase() ? <span key={i} className="search-match ...">{part}</span> : part);
    // 然后 useEffect 中 querySelectorAll('.search-match') 来获取 totalMatches。

    const getHighlightedContentWithId = (text) => {
        if (!text) return text;
        if (!searchQuery || !showSearch) return text;

        const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
        const parts = text.split(regex);
        return parts.map((part, i) =>
            part.toLowerCase() === searchQuery.toLowerCase() ?
                <span key={i} className="search-match bg-yellow-300 text-black">{part}</span> : part
        );
    };

    // Helper to clean content (remove duplicate title, fix literal tags)
    const getCleanContent = (content, title) => {
        if (!content) return '';
        let text = content;
        // Fix literal </br> or <br> tags appearing in text mode
        text = text.replace(/<\/?br\s*\/?>/gi, '\n');

        // Remove duplicate title if it appears at start (fuzzy match)
        if (title) {
            const cleanTitle = title.trim();
            const cleanText = text.trim();
            if (cleanText.startsWith(cleanTitle)) {
                text = cleanText.substring(cleanTitle.length).trim();
            }
        }
        return text;
    };

    const normalizeLightThemeEpubInlineColors = (html) => {
        if (!html) return html;
        return html.replace(/\bstyle\s*=\s*["']([^"']*)["']/gi, (m, styleValue) => {
            const replaced = styleValue.replace(
                /color\s*:\s*(#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(?:1|1\.0+)\s*\))\s*!important/gi,
                'color: #1f2937 !important'
            );
            return `style="${replaced}"`;
        });
    };

    // Search Match Counting Effect
    useEffect(() => {
        if (!showSearch || !searchQuery) {
            setTotalMatches(0);
            return;
        }

        const timer = setTimeout(() => {
            const matches = document.querySelectorAll('.search-match');
            if (!searchBuilt) setTotalMatches(matches.length);

            // 给每个 match 添加 ID 以便跳转
            matches.forEach((m, i) => {
                m.id = `search-match-${i}`;
            });

            if (matches.length > 0 && currentMatchIndex === -1) {
                // Find first visible match
                const container = contentRef.current;
                if (container) {
                    const containerTop = container.scrollTop;
                    let found = 0;
                    for (let i = 0; i < matches.length; i++) {
                        if (matches[i].offsetTop >= containerTop) {
                            found = i;
                            break;
                        }
                    }
                    setCurrentMatchIndex(found);
                }
            }
        }, 300); // Wait for render
        return () => clearTimeout(timer);
    }, [searchQuery, showSearch, loadedArticles]);

    // 搜索说明：只在当前已加载的章节中高亮搜索结果
    // 移除了全书索引构建(buildIndex)以避免触发速率限制
    // 搜索结果数量基于当前已加载章节的DOM元素统计

    // --- 加载逻辑 ---

    // --- 加载逻辑 ---

    // 获取章节数据 (带缓存)
    const getChapterData = async (index) => {
        // Skip chapter loading for image-based formats (handled by ImageReader)
        const fmt = stateRef.current.bookFormat;
        if (['pdf', 'comic', 'cbr', 'cbz', 'zip'].includes(fmt)) {
            return null;
        }

        // Check cache first
        if (stateRef.current.chapterContentCache.has(index)) {
            return stateRef.current.chapterContentCache.get(index);
        }

        const token = localStorage.getItem('token');
        const chapter = stateRef.current.chapters[index];
        if (!chapter) return null;

        try {
            let url = `/api/books/${bookId}/chapter/${index}`;
            if (fmt === 'epub' && chapter.href) url += `?href=${encodeURIComponent(chapter.href)}`;
            else {
                const start = chapter.line || 0;
                const end = stateRef.current.chapters[index + 1]?.line || -1;
                url += `?start=${start}&end=${end}`;
            }

            const res = await apiGet(url);
            if (!res.ok) {
                let errorMsg = 'Load failed';
                try {
                    const errData = await res.json();
                    if (errData.error) errorMsg = errData.error;
                } catch (e) { }
                throw new Error(errorMsg);
            }
            const data = await res.json();

            let content = data.content;
            if (!content) {
                // 如果内容为空但请求成功，可能是解析问题或空章节
                // 抛出错误以触发 UI 提示，而不是显示白屏
                throw new Error('章节内容为空');
            }

            // 图片路径处理
            if ((fmt === 'epub' || fmt === 'mobi' || fmt === 'azw3') && content) {
                const localToken = localStorage.getItem('token');
                const normalizeAssetUrl = (src) => {
                    if (!src) return src;
                    if (src.startsWith('http') || src.startsWith('data:')) return src;

                    let finalUrl = src;
                    if (src.startsWith('/')) {
                        finalUrl = getAbsoluteUrl(src);
                    }

                    if (finalUrl.includes('token=')) return finalUrl;

                    const separator = finalUrl.includes('?') ? '&' : '?';
                    if (src.startsWith('/api/books/')) {
                        return `${finalUrl}${separator}token=${localToken}`;
                    }

                    const apiPath = `/api/books/${bookId}/image?path=${encodeURIComponent(src)}&token=${localToken}`;
                    return getAbsoluteUrl(apiPath);
                };

                content = content
                    .replace(/<base\b[^>]*>/gi, '')
                    .replace(/<link\b[^>]*rel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi, '')
                    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, cssText) => {
                        const sanitizedCss = cssText
                            .replace(/@import\s+url\((?:['"])?[^)]+(?:['"])?\)\s*;?/gi, '')
                            .replace(/@import\s+(?:['"])[^'"]+(?:['"])\s*;?/gi, '');
                        return `<style${attrs}>${sanitizedCss}</style>`;
                    });

                content = content.replace(/\bsrc\s*=\s*["']?([^"'\s>]+)["']?/gi, (m, src) => {
                    const finalUrl = normalizeAssetUrl(src);
                    return `src="${finalUrl}"`;
                });

                content = content.replace(/<image\b[^>]*(?:href|xlink:href)\s*=\s*["']([^"'\s>]+)["'][^>]*>/gi, (m, src) => {
                    const finalUrl = normalizeAssetUrl(src);
                    return m.replace(src, finalUrl);
                });

                content = content.replace(/\bstyle\s*=\s*["']([^"']*)["']/gi, (m, styleValue) => {
                    const replaced = styleValue.replace(/url\((['"]?)([^'")]+)\1\)/gi, (u, quote, url) => {
                        const finalUrl = normalizeAssetUrl(url);
                        const q = quote || '';
                        return `url(${q}${finalUrl}${q})`;
                    });
                    return `style="${replaced}"`;
                });
            }

            const result = { content, title: chapter.title };
            // Save to cache
            stateRef.current.chapterContentCache.set(index, result);
            return result;

        } catch (e) {
            console.error(`Failed to fetch chapter ${index}`, e);
            throw e;
        }
    };

    // 预加载相邻章节 (静默)
    const preloadAdjacentChapters = async (currentIndex) => {
        const total = stateRef.current.chapters.length;

        // Preload Next
        if (currentIndex + 1 < total) {
            if (!stateRef.current.chapterContentCache.has(currentIndex + 1)) {
                // Use requestIdleCallback if available, or just async
                getChapterData(currentIndex + 1).catch(() => { });
            }
        }

        // Preload Previous
        if (currentIndex - 1 >= 0) {
            if (!stateRef.current.chapterContentCache.has(currentIndex - 1)) {
                getChapterData(currentIndex - 1).catch(() => { });
            }
        }
    };

    // Ref needed for scroll anchoring during prepend
    const prependScrollRef = useRef(null);

    // loadChapter 支持 prepend 和 isPreload
    const loadChapter = async (index, append = false, restoreScroll = 0, force = false, prepend = false, isPreload = false) => {
        // 边界检查
        if (index < 0 || index >= stateRef.current.chapters.length) return;

        // 如果只是预加载，且已经在加载中或已存在，则跳过 UI 更新
        if (isPreload) {
            if (stateRef.current.chapterContentCache.has(index)) return;
            await getChapterData(index);
            return;
        }

        // 防止重复加载 (除非 force 为 true)
        if (!force && stateRef.current.loading && !append && !prepend) return;

        // Check if already in loadedArticles (Jump logic handles this differently, maybe we force reload or checking)
        // For Jump (restoreScroll=0, !append, !prepend), we allow entering even if loaded to reset view context
        if (!force && !append && !prepend && stateRef.current.loadedArticles.some(a => a.index === index)) {
            // Optional: just scroll to it? For consistency with center loading, let's proceed to ensure N-1 is there.
        } else if (stateRef.current.loadedArticles.some(a => a.index === index) && !force) {
            return;
        }

        if (!prepend && !append) {
            setReaderError('');
            setLoading(true);
            stateRef.current.loading = true;
            setLoadingProgress(null);
        } else {
            stateRef.current.loading = true;
        }

        try {
            // ---------------------------------------------------------
            // CENTER LOADING LOGIC (Jump Mode / Scroll Mode)
            // ---------------------------------------------------------
            if (!append && !prepend && stateRef.current.viewMode === 'scroll' && index > 0) {
                // Fetch Current AND Previous
                const [currData, prevData] = await Promise.all([
                    getChapterData(index),
                    getChapterData(index - 1)
                ]);

                if (!currData) throw new Error("No data");

                const currArticle = { index, content: currData.content, title: currData.title };
                const articles = [];

                // Add Previous First
                if (prevData) {
                    articles.push({ index: index - 1, content: prevData.content, title: prevData.title });
                }
                articles.push(currArticle);

                setLoadedArticles(articles);
                setCurrentChapterIndex(index);
                stateRef.current.currentChapterIndex = index;

                // Scroll Restoration: Target the CURRENT chapter
                isRestoringRef.current = true;
                // 使用传入的恢复参数优先（包含 chapterPercent 和 anchorText 和 noteId），否则定位到章节顶部
                if (typeof restoreScroll === 'object' && restoreScroll !== null && (restoreScroll.chapterPercent !== undefined || restoreScroll.noteId)) {
                    pendingScrollRef.current = restoreScroll;
                } else {
                    pendingScrollRef.current = { index: index, offset: 0 };
                }

                // Progress
                if (restoreScroll === 0) {
                    const total = stateRef.current.chapters.length;
                    const globalPercent = total > 0 ? parseFloat(((index / total) * 100).toFixed(1)) : 0;
                    setReadingProgress(globalPercent);
                    saveProgress(index, 0, globalPercent);
                }

                preloadAdjacentChapters(index);

                if (!prepend && !append) setLoading(false);
                stateRef.current.loading = false;
                return;
            }
            // ---------------------------------------------------------

            const data = await getChapterData(index);
            if (!data) throw new Error("No data");

            const newArticle = { index, content: data.content, title: data.title };

            if (append) {
                setLoadedArticles(prev => {
                    if (prev.some(a => a.index === index)) return prev;
                    return [...prev, newArticle].sort((a, b) => a.index - b.index);
                });
            } else if (prepend) {
                if (contentRef.current) {
                    prependScrollRef.current = {
                        oldScrollHeight: contentRef.current.scrollHeight,
                        oldScrollTop: contentRef.current.scrollTop
                    };
                }
                setLoadedArticles(prev => {
                    if (prev.some(a => a.index === index)) return prev;
                    return [newArticle, ...prev].sort((a, b) => a.index - b.index);
                });
            } else {
                setLoadedArticles([newArticle]);
                setCurrentChapterIndex(index);
                // 立即同步更新 stateRef，避免 useEffect 异步延迟导致进度保存错误
                stateRef.current.currentChapterIndex = index;

                isRestoringRef.current = true;
                pendingScrollRef.current = restoreScroll;
            }

            if (!append && !prepend && restoreScroll === 0) {
                const total = stateRef.current.chapters.length;
                const globalPercent = total > 0 ? parseFloat(((index / total) * 100).toFixed(1)) : 0;
                setReadingProgress(globalPercent);
                saveProgress(index, 0, globalPercent);
            }

            // 翻页模式：初始化插槽 (首次加载或从滚动模式切换)
            const mode = stateRef.current.viewMode;
            const isPageMode = mode === 'h-page' || mode === 'instant' || mode === 'v-page';
            if (!append && !prepend && isPageMode) {
                // 初始化 Slot 0=Curr, Slot 1=Next, Slot 2=Prev
                const initialSlots = [null, null, null];
                initialSlots[0] = { index, content: data.content, title: data.title };

                // 异步预加载前后
                getChapterData(index + 1).then(d => {
                    if (d) setPageSlots(prev => { const n = [...prev]; n[1] = { index: index + 1, content: d.content, title: d.title }; return n; });
                }).catch(() => { });

                if (index > 0) {
                    getChapterData(index - 1).then(d => {
                        if (d) setPageSlots(prev => { const n = [...prev]; n[2] = { index: index - 1, content: d.content, title: d.title }; return n; });
                    }).catch(() => { });
                }

                setPageSlots(initialSlots);
                setActiveSlotId(0);
            } else {
                preloadAdjacentChapters(index);
            }

        } catch (e) {
            console.error(e);
            if (!append && !prepend) {
                setReaderError(e.message ? `加载失败: ${e.message}` : '加载失败');
            }
        } finally {
            if (!prepend && !append) {
                setLoading(false);
            }
            stateRef.current.loading = false;
        }
    };

    // 简化版 saveProgress：只保存章节索引 + 章节内百分比 + 锚点文本
    const saveProgress = useCallback((index, chapterPercent = 0, globalPercent = 0, anchorText = null) => {
        progressRef.current = { index, chapterPercent, globalPercent, anchorText };

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            const chapter = stateRef.current.chapters[index];
            const chapterTitle = chapter ? chapter.title : '';

            apiPost(`/api/books/${bookId}/progress`, {
                chapter_index: index,
                chapter_title: chapterTitle,
                chapter_percent: chapterPercent,
                progress_percent: globalPercent,
                anchor_text: anchorText
            }, { keepalive: true }).catch(console.error);
        }, 1000);
    }, [bookId, token]);

    // 空闲定时器：长时间停留在当前页面未翻页，自动保存一次进度
    const idleTimerRef = useRef(null);
    useEffect(() => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            const { index, chapterPercent, globalPercent, anchorText } = progressRef.current;
            const chapter = stateRef.current.chapters[index];
            const chapterTitle = chapter ? chapter.title : '';
            apiPost(`/api/books/${bookId}/progress`, {
                chapter_index: index,
                chapter_title: chapterTitle,
                chapter_percent: chapterPercent,
                progress_percent: globalPercent,
                anchor_text: anchorText,
                force: true
            }, { keepalive: true }).catch(console.error);
        }, 3 * 60 * 1000); // 3 分钟
        return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
    }, [currentChapterIndex, bookId, token]);

    // 后台切换保存：页面进入后台时立即保存进度
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                const { index, chapterPercent, globalPercent, anchorText } = progressRef.current;
                const chapter = stateRef.current.chapters[index];
                const chapterTitle = chapter ? chapter.title : '';
                const localToken = localStorage.getItem('token');
                const data = JSON.stringify({
                    chapter_index: index,
                    chapter_title: chapterTitle,
                    chapter_percent: chapterPercent || 0,
                    progress_percent: globalPercent || 0,
                    anchor_text: anchorText,
                    force: true,
                    token: localToken
                });
                const url = getAbsoluteUrl(`/api/books/${bookId}/progress`);
                const sent = navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
                if (!sent) {
                    apiPost(`/api/books/${bookId}/progress`, JSON.parse(data), { keepalive: true }).catch(console.error);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [bookId]);

    // Save on unmount - 使用 sendBeacon 确保可靠发送
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            const { index, chapterPercent, globalPercent, anchorText } = progressRef.current;

            const chapter = stateRef.current.chapters[index];
            const chapterTitle = chapter ? chapter.title : '';
            const localToken = localStorage.getItem('token');

            const data = JSON.stringify({
                chapter_index: index,
                chapter_title: chapterTitle,
                chapter_percent: chapterPercent || 0,
                progress_percent: globalPercent || 0,
                anchor_text: anchorText,
                force: true,
                token: localToken
            });

            const url = getAbsoluteUrl(`/api/books/${bookId}/progress`);

            const sent = navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
            if (!sent) {
                apiPost(`/api/books/${bookId}/progress`, JSON.parse(data), { keepalive: true }).catch(console.error);
            }
        };
    }, [bookId]);

    // 简化版滚动恢复：使用章节内百分比 + 锚点文本修正
    useLayoutEffect(() => {
        // Handle Prepend Scroll Anchoring
        if (prependScrollRef.current && contentRef.current) {
            const container = contentRef.current;
            const { oldScrollHeight, oldScrollTop } = prependScrollRef.current;
            const newScrollHeight = container.scrollHeight;
            const diff = newScrollHeight - oldScrollHeight;

            if (diff > 0) {
                // Adjust scroll position to maintain visual stability
                container.scrollTop = oldScrollTop + diff;
                console.log(`[Prepend] Anchored scroll: +${diff}px`);
            }
            prependScrollRef.current = null;
            return; // Skip normal restore if handling prepend
        }

        if (pendingScrollRef.current !== null && contentRef.current && loadedArticles.length > 0) {
            const target = pendingScrollRef.current;
            const container = contentRef.current;

            // 延迟一帧确保内容已渲染
            const restore = () => {
                const mode = stateRef.current.viewMode;
                let scrollTopVal = 0;
                let scrollLeftVal = 0;
                let needsCorrection = false;

                console.log('[Reader] Restoring scroll:', target, 'Mode:', mode);

                // Handle Note ID Target
                if (typeof target === 'object' && target.noteId) {
                    const noteEl = container.querySelector(`[data-note-id="${target.noteId}"]`);
                    if (noteEl) {
                        if (mode === 'scroll') {
                            scrollTopVal = noteEl.offsetTop - (container.clientHeight / 2) + (noteEl.offsetHeight / 2);
                        } else if (mode === 'h-page' || mode === 'instant') {
                            const pageStep = container.clientWidth;
                            const pageIndex = Math.floor(noteEl.offsetLeft / pageStep);
                            scrollLeftVal = pageIndex * pageStep;
                        } else {
                            scrollTopVal = noteEl.offsetTop;
                        }
                        console.log('[Reader] Restored to note:', target.noteId);
                    }
                } else if (typeof target === 'object' && target.index !== undefined) {
                    // Find element with data-index
                    const el = container.querySelector(`.chapter-article[data-index="${target.index}"]`);
                    // console.log("Target Element Restore:", target.index, el);
                    if (el) {
                        if (mode === 'scroll') {
                            scrollTopVal = el.offsetTop + (target.offset || 0);
                        } else {
                            // Page modes usually don't use offsetTop in standard way, but allow fallback
                            // Or handle differently if we support center loading there (currently only scroll)
                        }
                    }
                } else if (target === 'bottom') {
                    // 跳转到章节末尾
                    if (mode === 'h-page' || mode === 'instant') {
                        scrollLeftVal = container.scrollWidth - container.clientWidth;
                    } else {
                        scrollTopVal = container.scrollHeight;
                    }
                } else if (typeof target === 'object' && target.chapterPercent !== undefined) {
                    // 1. 先使用章节内百分比计算粗略滚动位置
                    if (mode === 'h-page' || mode === 'instant') {
                        // 翻页模式：需要页对齐
                        const pageStep = container.clientWidth; // 每页宽度
                        const scrollable = container.scrollWidth - container.clientWidth;
                        const totalPages = Math.ceil(container.scrollWidth / pageStep);

                        // 根据百分比计算目标页码（四舍五入到最近的页）
                        const targetPage = Math.round((target.chapterPercent / 100) * (totalPages - 1));
                        // 对齐到页边界
                        scrollLeftVal = targetPage * pageStep;

                        // 确保不超过最大滚动范围
                        if (scrollLeftVal > scrollable) {
                            scrollLeftVal = scrollable;
                        }

                        console.log('[Reader] H-Page restore: percent=', target.chapterPercent,
                            'totalPages=', totalPages, 'targetPage=', targetPage,
                            'scrollLeft=', scrollLeftVal, 'pageStep=', pageStep);
                    } else if (mode === 'v-page') {
                        // 上下翻页模式：单章节显示，直接用容器百分比
                        const scrollable = container.scrollHeight - container.clientHeight;
                        scrollTopVal = Math.round((target.chapterPercent / 100) * scrollable);
                        console.log('[Reader] V-Page restore: scrollTop=', scrollTopVal, 'percent=', target.chapterPercent);
                    } else {
                        // 滚动模式：需要找到目标章节元素，计算章节内的精确位置
                        const targetChapterDOM = container.querySelector(`.chapter-article[data-index="${stateRef.current.currentChapterIndex}"]`);
                        if (targetChapterDOM) {
                            // 章节的起始位置 + 章节高度 × 百分比
                            const chapterTop = targetChapterDOM.offsetTop;
                            const chapterHeight = targetChapterDOM.offsetHeight;
                            const offsetInChapter = Math.round((target.chapterPercent / 100) * chapterHeight);
                            scrollTopVal = chapterTop + offsetInChapter;
                            console.log('[Reader] Scroll restore: chapterTop=', chapterTop, 'chapterHeight=', chapterHeight, 'offset=', offsetInChapter, 'scrollTop=', scrollTopVal);
                        } else {
                            // 回退：使用容器总高度（不够精确）
                            const scrollable = container.scrollHeight - container.clientHeight;
                            scrollTopVal = Math.round((target.chapterPercent / 100) * scrollable);
                            console.log('[Reader] Scroll restore (fallback): scrollTop=', scrollTopVal);
                        }
                    }

                    if (target.anchorText && target.anchorText.length > 5) {
                        needsCorrection = true;
                    }
                } else if (typeof target === 'number') {
                    scrollTopVal = target;
                }

                if (mode === 'h-page' || mode === 'instant') {
                    container.scrollLeft = scrollLeftVal;
                } else {
                    // 确保应用粗略滚动位置 (除非 needsCorrection 已经处理了)
                    if (Math.abs(container.scrollTop - scrollTopVal) > 5) {
                        container.scrollTop = scrollTopVal;
                    }
                }
                return needsCorrection;
            };

            const doCorrection = (anchorText) => {
                // 第二阶段：精确修正（支持所有 viewMode）
                console.log('[Reader] Doing correction for:', anchorText);
                if (!anchorText || !contentRef.current) return false;
                const container = contentRef.current;
                const mode = stateRef.current.viewMode;
                const currentChapterDOM = container.querySelector(`.chapter-article[data-index="${stateRef.current.currentChapterIndex}"]`);

                if (currentChapterDOM) {
                    const walker = document.createTreeWalker(currentChapterDOM, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    const searchPhrase = anchorText.trim();
                    while ((node = walker.nextNode())) {
                        const sourceText = node.textContent || '';
                        const matchIndex = sourceText.indexOf(searchPhrase);
                        if (matchIndex >= 0) {
                            const range = document.createRange();
                            const endIndex = Math.min(sourceText.length, matchIndex + searchPhrase.length);
                            range.setStart(node, matchIndex);
                            range.setEnd(node, endIndex);
                            const rect = range.getBoundingClientRect();
                            const containerRect = container.getBoundingClientRect();

                            if (mode === 'h-page' || mode === 'instant') {
                                // 翻页模式：根据锚点的 offsetLeft 计算所在页码并 snap
                                const pageStep = container.getBoundingClientRect().width;
                                const anchorLeft = rect.left - containerRect.left + container.scrollLeft;
                                const targetPage = Math.max(0, Math.round(anchorLeft / pageStep));
                                const targetLeft = targetPage * pageStep;
                                if (Math.abs(container.scrollLeft - targetLeft) > 5) {
                                    container.scrollLeft = targetLeft;
                                    console.log('[Reader] H-Page corrected to page:', targetPage);
                                }
                            } else {
                                // scroll / v-page 模式：纵向修正
                                const targetTop = container.scrollTop + (rect.top - containerRect.top) - 20;
                                container.scrollTop = Math.max(0, targetTop);
                                console.log('[Reader] Corrected scroll to:', container.scrollTop);
                            }
                            return true;
                        }
                    }
                }
                return false;
            };

            // 翻页模式需要更长的延迟确保 CSS 多列布局完全渲染
            const mode = stateRef.current.viewMode;
            const isPageMode = mode === 'h-page' || mode === 'instant';
            const initialDelay = isPageMode ? 100 : 0; // 翻页模式先等待布局稳定

            setTimeout(() => {
                requestAnimationFrame(() => {
                    const needsCorrection = restore();

                    // 等待滚动事件稳定
                    setTimeout(() => {
                        if (needsCorrection && typeof target === 'object' && target.anchorText) {
                            doCorrection(target.anchorText);
                        }

                        restoreSnapSuppressUntilRef.current = Date.now() + 500;
                        isRestoringRef.current = false;
                        pendingScrollRef.current = null;
                        setIsInitialRestoring(false); // 恢复完成，显示内容
                    }, isPageMode ? 200 : 150);
                });
            }, initialDelay);
        }
    }, [loadedArticles]);

    // --- 交互处理 ---

    const handleScroll = (e) => {
        if (activePanel || showFontSpacingModal || isRestoringRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = e.target;

        // 【关键修复】选区保护逻辑：如果有选区且在翻页模式下，强制锁定在当前页
        // 防止浏览器原生的选区拖动行为导致飞速翻页（"一下子选中好多页"）
        // 配合 selectionStartPageRef，将视口锁定在选区开始时的页面
        // 注：虽然有 RAF 循环锁定，但 scroll 事件响应通常比 RAF 更快，这里保留双重锁定以确保稳固
        if ((stateRef.current.viewMode === 'h-page' || stateRef.current.viewMode === 'instant') &&
            (hasSelectionRef.current || isSelectionActive())) {

            const container = contentRef.current;
            if (container && selectionStartPageRef.current !== null) {
                const pageStep = container.getBoundingClientRect().width;
                const targetLeft = selectionStartPageRef.current * pageStep;

                // 如果滚动偏离超过 0.5px，强制归位
                if (Math.abs(container.scrollLeft - targetLeft) > 0.5) {
                    container.scrollLeft = targetLeft;
                    return; // 阻止后续逻辑，彻底屏蔽滚动
                }
            }
        }

        // 翻页模式自动吸附逻辑
        if ((stateRef.current.viewMode === 'h-page' || stateRef.current.viewMode === 'instant') &&
            !isTouchingRef.current &&
            Date.now() >= restoreSnapSuppressUntilRef.current) {
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(() => {
                const container = contentRef.current;
                if (!container) return;

                const { scrollLeft } = container;
                // 使用 getBoundingClientRect().width 作为页宽基准
                const pageStep = container.getBoundingClientRect().width;
                const pageIndex = Math.round(scrollLeft / pageStep);
                const targetLeft = pageIndex * pageStep;

                // 如果未对齐且有偏差，执行平滑吸附
                if (Math.abs(scrollLeft - targetLeft) > 5) {
                    // console.log('[Reader] Auto-snapping to page', pageIndex);
                    // 仅当当前已经停止滚动（再次确认）时
                    container.scrollTo({ left: targetLeft, behavior: 'smooth' });
                }
            }, 100); // 100ms 防抖
        }

        const total = stateRef.current.chapters.length;
        let currentIndex = stateRef.current.currentChapterIndex;
        let chapterPercent = 0;
        let globalPercent = 0;

        if (total > 0 && contentRef.current) {
            if (stateRef.current.viewMode === 'scroll') {
                // 滚动模式：查找当前可见章节
                const articles = Array.from(contentRef.current.getElementsByClassName('chapter-article'));
                let visibleArticle = null;

                for (const article of articles) {
                    const rect = article.getBoundingClientRect();
                    if (rect.bottom > 60) {
                        visibleArticle = article;
                        break;
                    }
                }

                if (visibleArticle) {
                    const idx = parseInt(visibleArticle.getAttribute('data-index'));
                    if (!isNaN(idx)) {
                        currentIndex = idx;
                        stateRef.current.currentChapterIndex = idx;
                        if (currentIndex !== currentChapterIndex) {
                            setCurrentChapterIndex(idx);
                        }

                        // 计算章节内百分比
                        const rect = visibleArticle.getBoundingClientRect();
                        const chapterHeight = rect.height;
                        const scrolledInChapter = Math.max(0, -rect.top);
                        const chapterRatio = chapterHeight > 0 ? Math.min(1, scrolledInChapter / chapterHeight) : 0;
                        chapterPercent = parseFloat((chapterRatio * 100).toFixed(1));

                        // 捕获锚点文本 (Unified logic using caretRangeFromPoint)
                        let anchorText = null;
                        try {
                            const probeY = 80; // Header + margin
                            const probeXs = [
                                (stateRef.current.marginH || 20) + 40,
                                window.innerWidth / 2
                            ];
                            let range = null;
                            for (const probeX of probeXs) {
                                try {
                                    if (document.caretRangeFromPoint) {
                                        range = document.caretRangeFromPoint(probeX, probeY);
                                    } else if (document.caretPositionFromPoint) {
                                        const pos = document.caretPositionFromPoint(probeX, probeY);
                                        if (pos) {
                                            range = document.createRange();
                                            range.setStart(pos.offsetNode, pos.offset);
                                            range.setEnd(pos.offsetNode, pos.offset);
                                        }
                                    }
                                } catch (e) { /* ignore */ }
                                if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) break;
                            }
                            
                            if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
                                const text = range.startContainer.textContent.substring(range.startOffset).trim();
                                if (text.length > 5) {
                                    anchorText = text.substring(0, 30);
                                } else {
                                    // 文本太短，尝试拼接下一个兄弟节点
                                    anchorText = (text + ' ' + (range.startContainer.nextSibling?.textContent || '')).trim().substring(0, 30);
                                }
                            }
                        } catch (e) { /* ignore */ }

                        // Fallback to TreeWalker if caret capture failed
                        if (!anchorText) {
                            const walker = document.createTreeWalker(visibleArticle, NodeFilter.SHOW_TEXT, null, false);
                            let node;
                            while ((node = walker.nextNode())) {
                                // 忽略空节点
                                if (!node.textContent.trim()) continue;

                                // 获取节点位置
                                const range = document.createRange();
                                range.selectNode(node);
                                const nodeRect = range.getBoundingClientRect();

                                // 如果节点已经在视口顶部附近 (允许 -20px 到 +100px 的误差)
                                if (nodeRect.bottom > 0 && nodeRect.top < clientHeight) { // 只要在屏幕内
                                    // 进一步筛选：我们只想要最上面那一个
                                    if (nodeRect.top >= 0 || (nodeRect.top < 0 && nodeRect.bottom > 20)) {
                                        // 截取前30个字符作为锚点
                                        anchorText = node.textContent.trim().substring(0, 30);
                                        break;
                                    }
                                }
                            }
                        }

                        // 计算全局进度
                        globalPercent = parseFloat((((idx + chapterRatio) / total) * 100).toFixed(1));
                        setReadingProgress(globalPercent);

                        // 保存进度
                        saveProgress(currentIndex, chapterPercent, globalPercent, anchorText);
                    }
                }
            } else {
                // 翻页模式：计算章节内百分比
                let chapterRatio = 0;
                if (stateRef.current.viewMode === 'h-page' || stateRef.current.viewMode === 'instant') {
                    // 横向模式
                    const { scrollLeft, scrollWidth } = e.target;
                    const clientWidth = e.target.getBoundingClientRect().width; // Use getBoundingClientRect().width
                    const scrollable = scrollWidth - clientWidth;
                    chapterRatio = scrollable > 0 ? scrollLeft / scrollable : 0;
                } else {
                    // 纵向模式 (v-page)
                    const scrollable = scrollHeight - clientHeight;
                    chapterRatio = scrollable > 0 ? scrollTop / scrollable : 0;
                }

                chapterPercent = parseFloat((chapterRatio * 100).toFixed(1));

                // 翻页模式锚点捕获：使用 caretRangeFromPoint 探测当前页可见文本
                let anchorText = null;
                try {
                    const probeY = 80; // Header + margin
                    const probeXs = [
                        (stateRef.current.marginH || 20) + 40,
                        window.innerWidth / 2
                    ];
                    let range = null;
                    for (const probeX of probeXs) {
                        try {
                            if (document.caretRangeFromPoint) {
                                range = document.caretRangeFromPoint(probeX, probeY);
                            } else if (document.caretPositionFromPoint) {
                                const pos = document.caretPositionFromPoint(probeX, probeY);
                                if (pos) {
                                    range = document.createRange();
                                    range.setStart(pos.offsetNode, pos.offset);
                                    range.setEnd(pos.offsetNode, pos.offset);
                                }
                            }
                        } catch (e) { /* ignore */ }
                        if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) break;
                    }
                    if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
                        const text = range.startContainer.textContent.substring(range.startOffset).trim();
                        if (text.length > 5) {
                            anchorText = text.substring(0, 30);
                        } else {
                            // 文本太短，尝试拼接下一个兄弟节点
                            anchorText = (text + ' ' + (range.startContainer.nextSibling?.textContent || '')).trim().substring(0, 30);
                        }
                    }
                } catch (e) { /* ignore anchor capture errors */ }

                globalPercent = parseFloat((((currentIndex + chapterRatio) / total) * 100).toFixed(1));
                setReadingProgress(globalPercent);

                // 保存进度
                saveProgress(currentIndex, chapterPercent, globalPercent, anchorText);
            }
        }

        // 滚动模式：自动加载下一章 + 自动加载上一章(Prepend)
        if (stateRef.current.viewMode === 'scroll') {
            // Append Logic
            if (scrollHeight - scrollTop - clientHeight < 500 && !stateRef.current.loading) {
                const loaded = stateRef.current.loadedArticles;
                if (loaded.length > 0) {
                    const lastIdx = loaded[loaded.length - 1].index;
                    if (lastIdx < stateRef.current.chapters.length - 1) {
                        loadChapter(lastIdx + 1, true); // append=true
                    }
                }
            }

            // Prepend Logic (Seamless Scroll Up)
            if (scrollTop < 50 && !stateRef.current.loading) {
                const loaded = stateRef.current.loadedArticles;
                if (loaded.length > 0) {
                    const firstIdx = loaded[0].index;
                    if (firstIdx > 0) {
                        // console.log("Prepending chapter", firstIdx - 1);
                        loadChapter(firstIdx - 1, false, 0, false, true); // prepend=true
                    }
                }
            }
        }
    };

    // Touch Handlers for Page Turning
    const touchStartRef = useRef(null);
    const longPressTimeoutRef = useRef(null);
    const hasSelectionRef = useRef(false);
    const selectionStartPageRef = useRef(null); // 记录选区开始时的页码
    const scrollLockRafRef = useRef(null); // 滚动锁定 RAF 句柄
    const pendingAnchorRef = useRef(null);

    // 辅助函数：检测是否存在活跃选区
    const isSelectionActive = () => {
        const selection = window.getSelection();
        if (!selection) return false;
        // 检查 type === 'Range' 或者 rangeCount > 0 且非折叠
        return selection.type === 'Range' || (!selection.isCollapsed && selection.toString().length > 0);
    };

    // 监听选区变化，确保在有选区时禁用翻页
    useEffect(() => {
        // 模式切换时，重置触摸状态，防止状态残留
        isTouchingRef.current = false;
        touchStartRef.current = null;
        selectionStartPageRef.current = null;
        if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
        if (scrollLockRafRef.current) cancelAnimationFrame(scrollLockRafRef.current);

        // 初始化检查：如果已有选区，同步状态
        hasSelectionRef.current = isSelectionActive();

        // 滚动锁定循环：高频强制重置滚动位置，解决浏览器自动滚动的闪烁问题
        const lockScrollLoop = () => {
            if (!hasSelectionRef.current) return;

            const container = contentRef.current;
            if (container && selectionStartPageRef.current !== null &&
                (stateRef.current.viewMode === 'h-page' || stateRef.current.viewMode === 'instant')) {
                const pageStep = container.getBoundingClientRect().width;
                const targetLeft = selectionStartPageRef.current * pageStep;

                // 如果发生偏移，立即强制归位（不使用 smooth，防止视觉滞后）
                if (Math.abs(container.scrollLeft - targetLeft) > 0.5) {
                    container.scrollLeft = targetLeft;
                }
            }
            scrollLockRafRef.current = requestAnimationFrame(lockScrollLoop);
        };

        const handleSelectionChange = () => {
            const hasSelection = isSelectionActive();

            // 选区开始瞬间，记录当前页码，用于后续锁定滚动
            if (hasSelection && !hasSelectionRef.current) {
                const container = contentRef.current;
                if (container && (stateRef.current.viewMode === 'h-page' || stateRef.current.viewMode === 'instant')) {
                    const pageStep = container.getBoundingClientRect().width;
                    selectionStartPageRef.current = Math.round(container.scrollLeft / pageStep);
                }

                // 启动 RAF 锁定循环
                if (scrollLockRafRef.current) cancelAnimationFrame(scrollLockRafRef.current);
                scrollLockRafRef.current = requestAnimationFrame(lockScrollLoop);

            } else if (!hasSelection) {
                selectionStartPageRef.current = null;
                // 停止 RAF 锁定循环
                if (scrollLockRafRef.current) cancelAnimationFrame(scrollLockRafRef.current);
            }

            hasSelectionRef.current = hasSelection;

            // 如果在滑动过程中产生了选区（例如长按选词成功），立即中断滑动逻辑
            if (hasSelection && isTouchingRef.current) {
                isTouchingRef.current = false;
                touchStartRef.current = null;
                if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
                // console.log('[Reader] Selection detected during touch, aborting swipe');
            }
        };

        const handleContextMenu = () => {
            // 弹出菜单通常意味着长按选词成功，立即终止翻页
            isTouchingRef.current = false;
            touchStartRef.current = null;
            if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

            // 确保记录当前页码（应对 selectionchange 触发时机问题）
            if (selectionStartPageRef.current === null) {
                const container = contentRef.current;
                if (container && (stateRef.current.viewMode === 'h-page' || stateRef.current.viewMode === 'instant')) {
                    const pageStep = container.getBoundingClientRect().width;
                    selectionStartPageRef.current = Math.round(container.scrollLeft / pageStep);
                }
                // 启动 RAF 锁定循环
                if (!scrollLockRafRef.current) {
                    scrollLockRafRef.current = requestAnimationFrame(lockScrollLoop);
                }
            }
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('contextmenu', handleContextMenu);
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange);
            document.removeEventListener('contextmenu', handleContextMenu);
            if (scrollLockRafRef.current) cancelAnimationFrame(scrollLockRafRef.current);
        };
    }, [viewMode]); // 添加 viewMode 依赖，确保模式切换后重新初始化监听器和状态

    const handleTouchStart = (e) => {
        // 禁止在有选中文本时触发滑动翻页，防止冲突
        // 双重检查：引用状态 + 实时状态
        if (hasSelectionRef.current || isSelectionActive()) return;

        isTouchingRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

        // 长按检测：如果按下超过 300ms 且没有大幅移动，视为长按选文本，取消翻页逻辑
        longPressTimeoutRef.current = setTimeout(() => {
            if (isTouchingRef.current) {
                isTouchingRef.current = false;
                touchStartRef.current = null;
            }
        }, 300);

        // 计算每页步长：始终使用屏幕宽度
        const { innerWidth } = window;
        const pageStep = innerWidth;

        touchStartRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now(),
            startPageH: contentRef.current ? Math.round(contentRef.current.scrollLeft / pageStep) : 0,
            startScrollTop: contentRef.current ? contentRef.current.scrollTop : 0, // 记录初始滚动位置
            startScrollLeft: contentRef.current ? contentRef.current.scrollLeft : 0,
            pageStep: pageStep
        };
    };

    const handleTouchMove = (e) => {
        // 如果在滑动过程中检测到选中文本，立即停止自定义滑动逻辑
        if (hasSelectionRef.current || isSelectionActive()) {
            isTouchingRef.current = false;
            touchStartRef.current = null;
            if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
            return;
        }

        if (!isTouchingRef.current || !touchStartRef.current) return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const startX = touchStartRef.current.x;
        const startY = touchStartRef.current.y;
        const dx = currentX - startX;
        const dy = currentY - startY;

        // 移动阈值检测：如果是微小移动（手抖），视为长按过程，不触发翻页
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

        // 【关键修复】增加对翻页意图的确认，防止选区微调被误判为翻页
        // 如果没有锁定翻页方向，且水平移动距离还不够大（< 30px），不触发翻页
        // 这样可以给浏览器足够的时间去处理长按选词或选区调整
        const mode = stateRef.current.viewMode;
        if ((mode === 'h-page' || mode === 'instant') && Math.abs(dx) < 30) {
            return;
        }

        // 移动幅度超过阈值，确认为滑动翻页意图，取消长按检测
        if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
        }

        if (mode !== 'h-page' && mode !== 'instant') return;

        // Prevent native scrolling
        if (e.cancelable) e.preventDefault();

        const container = contentRef.current;
        if (container) {
            // Manual 1:1 scroll tracking，限制最大偏移为 ±1 页防止漂移
            const { startScrollLeft, pageStep } = touchStartRef.current;
            const clampedDx = Math.max(-pageStep, Math.min(pageStep, dx));
            container.scrollLeft = startScrollLeft - clampedDx;
        }
    };

    const handleTouchEnd = (e) => {
        if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

        isTouchingRef.current = false;
        if (!touchStartRef.current) return;

        const touchEnd = {
            x: e.changedTouches[0].clientX,
            y: e.changedTouches[0].clientY,
            time: Date.now()
        };

        const dx = touchEnd.x - touchStartRef.current.x;
        const dy = touchEnd.y - touchStartRef.current.y;
        const dt = touchEnd.time - touchStartRef.current.time;
        const startPageH = touchStartRef.current.startPageH;
        const startScrollTop = touchStartRef.current.startScrollTop;

        // 先清空 ref（在提取完所有需要的值之后）
        touchStartRef.current = null;

        // Ignore if text selection
        if (isSelectionActive()) return;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // 慢速滑动（>500ms）或距离不足（<30px）：snap 回起始页
        if (dt > 500 || Math.max(absDx, absDy) < 30) {
            if (viewMode === 'h-page' || viewMode === 'instant') {
                const container = contentRef.current;
                if (container) {
                    const scrollBehavior = viewMode === 'instant' ? 'instant' : 'smooth';
                    const pageStep = container.getBoundingClientRect().width;
                    container.scrollTo({ left: startPageH * pageStep, behavior: scrollBehavior });
                }
            }
            return;
        }

        const container = contentRef.current;
        if (!container) return;

        const { innerWidth, innerHeight } = window;
        // 使用容器实际宽度作为步长，确保与 CSS 列宽 (Stretch-to-fit) 完全一致
        const clientWidth = container.clientWidth;

        if (viewMode === 'h-page' || viewMode === 'instant') {
            // Horizontal Swipe
            // Use 'smooth' for h-page (animation), 'instant' for instant mode
            // For manual drag release, 'smooth' ensures it snaps nicely. 
            // BUT for 'instant' mode, user might expect no animation. 
            // However, after a drag, snapping needs some visual feedback or instant jump.
            // Let's stick to user preference: if instant, snap instantly.
            const scrollBehavior = viewMode === 'instant' ? 'instant' : 'smooth';
            // 优先使用 container.getBoundingClientRect().width，因为这是实际渲染的列宽
            const pageStep = container.getBoundingClientRect().width;

            if (absDx > absDy) {
                if (dx > 0) {
                    // Swipe Right -> Prev Page
                    if (startPageH <= 0) {
                        prevChapter(true);
                    } else {
                        // Limit to EXACTLY one page back
                        container.scrollTo({ left: (startPageH - 1) * pageStep, behavior: scrollBehavior });
                    }
                } else {
                    // Swipe Left -> Next Page
                    const maxScroll = container.scrollWidth - pageStep;
                    // 先检查当前是否已在最后一页
                    if (container.scrollLeft >= maxScroll - 5) { // Use current scrollLeft which was updated by drag
                        if (startPageH >= Math.round(maxScroll / pageStep)) {
                            nextChapter();
                        } else {
                            // Snap to last page
                            container.scrollTo({ left: maxScroll, behavior: scrollBehavior });
                        }
                    } else {
                        // Limit to EXACTLY one page forward
                        const targetScroll = Math.min((startPageH + 1) * pageStep, maxScroll);
                        container.scrollTo({ left: targetScroll, behavior: scrollBehavior });
                    }
                }
            } else {
                // Revert if vertical swipe dominates or tap (shouldn't happen with threshold check)
                // Snap back to original page
                container.scrollTo({ left: startPageH * pageStep, behavior: scrollBehavior });
            }
        }
        else if (viewMode === 'scroll') {
            // Scroll Mode Swipe Logic
            // Support "Pull Down to Prev Chapter"
            if (dy > 0 && absDy > absDx && startScrollTop <= 0) {
                prevChapter(true);
            }
            // Support "Pull Up to Next Chapter" (At bottom)
            else if (dy < 0 && absDy > absDx) {
                const { scrollHeight, scrollTop, clientHeight } = container;
                // If we are effectively at the bottom (allow small margin)
                if (scrollHeight - scrollTop - clientHeight <= 10) {
                    const loaded = stateRef.current.loadedArticles;
                    if (loaded.length > 0) {
                        const lastIdx = loaded[loaded.length - 1].index;
                        // Avoid duplicates if already loading or at end
                        if (lastIdx < stateRef.current.chapters.length - 1 && !stateRef.current.loading) {
                            loadChapter(lastIdx + 1, true);
                        }
                    }
                }
            }
        }
        else if (viewMode === 'v-page') {
            // Vertical Swipe
            if (absDy > absDx) {
                const oneLineHeight = fontSize * lineHeight;
                const overlap = oneLineHeight * 2;
                const rawScrollAmount = innerHeight - overlap;
                const scrollAmount = Math.floor(rawScrollAmount / oneLineHeight) * oneLineHeight;

                if (dy > 0) {
                    // Swipe Down -> Prev Page (Scroll Up)
                    if (container.scrollTop <= 5) {
                        prevChapter(true);
                    } else {
                        container.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
                    }
                } else {
                    // Swipe Up -> Next Page (Scroll Down)
                    const maxScroll = container.scrollHeight - innerHeight;
                    if (container.scrollTop >= maxScroll - 5) {
                        nextChapter();
                    } else {
                        container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                    }
                }
            }
        }
    };

    // Mouse Wheel Handler for Desktop "Scroll Up to Prev Chapter"
    const handleWheel = (e) => {
        if (stateRef.current.viewMode !== 'scroll') return;
        const container = contentRef.current;
        if (!container) return;

        // If scrolling UP (deltaY < 0) and at the very top (scrollTop === 0)
        // We trigger previous chapter load.
        // We use a small threshold (e.g., 0) to be strict, or capture overscroll events if needed.
        if (e.deltaY < 0 && container.scrollTop <= 0) {
            // Check if we are already doing something?
            // Maybe debounce this?
            // Rely on loadChapter's internal checks.
            prevChapter(true);
        }
    };

    const findAnchorElement = useCallback((container, id) => {
        if (!container || !id) return null;
        const safeId = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, '\\$&');
        return container.querySelector(`#${safeId}`) || container.querySelector(`[name="${id}"]`);
    }, []);

    const scrollToAnchorElement = useCallback((el) => {
        const container = contentRef.current;
        if (!container || !el) return false;
        const mode = stateRef.current.viewMode;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        if (mode === 'h-page' || mode === 'instant') {
            const pageStep = container.getBoundingClientRect().width;
            const left = elRect.left - containerRect.left + container.scrollLeft;
            const pageIndex = Math.floor(left / pageStep);
            container.scrollTo({ left: pageIndex * pageStep, behavior: 'smooth' });
        } else {
            const top = elRect.top - containerRect.top + container.scrollTop - 24;
            container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
        return true;
    }, []);

    const handleInternalAnchor = useCallback((rawHref) => {
        if (!rawHref) return false;
        const href = rawHref.trim();
        if (!href) return false;
        if (href.startsWith('#')) {
            const id = decodeURIComponent(href.slice(1));
            const container = contentRef.current;
            const target = container ? findAnchorElement(container, id) : null;
            if (target) return scrollToAnchorElement(target);
            return false;
        }
        const [rawPath, rawHash] = href.split('#');
        const path = rawPath ? decodeURIComponent(rawPath) : '';
        const hash = rawHash ? decodeURIComponent(rawHash) : '';
        const chapters = stateRef.current.chapters;
        const currentIndex = stateRef.current.currentChapterIndex;
        let targetIndex = currentIndex;
        if (path) {
            targetIndex = chapters.findIndex(c => c.href && (c.href === path || c.href.endsWith(path) || path.endsWith(c.href)));
        }
        if (targetIndex === -1) return false;
        if (targetIndex !== currentIndex) {
            pendingAnchorRef.current = { index: targetIndex, id: hash || null };
            loadChapter(targetIndex, false, 0, true);
            setShowControls(false);
            return true;
        }
        if (hash) {
            const container = contentRef.current;
            const target = container ? findAnchorElement(container, hash) : null;
            if (target) return scrollToAnchorElement(target);
        }
        return false;
    }, [findAnchorElement, scrollToAnchorElement, loadChapter]);

    useEffect(() => {
        const pending = pendingAnchorRef.current;
        if (!pending) return;
        if (pending.index !== stateRef.current.currentChapterIndex) return;
        const container = contentRef.current;
        if (!container) return;
        if (!pending.id) {
            pendingAnchorRef.current = null;
            return;
        }
        const target = findAnchorElement(container, pending.id);
        if (target) {
            scrollToAnchorElement(target);
            pendingAnchorRef.current = null;
        }
    }, [loadedArticles, viewMode, findAnchorElement, scrollToAnchorElement]);

    // 点击内容区域处理 (翻页 / 菜单)
    const handleContentClick = (e) => {
        if (isSelectionActive()) return;

        // Check for note click
        let targetElement = e.target;
        if (targetElement.nodeType === 3) { // Handle text nodes
            targetElement = targetElement.parentElement;
        }

        const anchorElement = targetElement.closest ? targetElement.closest('a') : null;
        if (anchorElement && contentRef.current && contentRef.current.contains(anchorElement)) {
            const href = anchorElement.getAttribute('href') || '';
            const isExternal = /^https?:\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
            if (!isExternal && ['epub', 'mobi', 'azw3'].includes(stateRef.current.bookFormat)) {
                e.preventDefault();
                e.stopPropagation();
                handleInternalAnchor(href);
                return;
            }
        }

        const highlightElement = targetElement.closest ? targetElement.closest('[data-note-id]') : null;

        if (highlightElement && contentRef.current && contentRef.current.contains(highlightElement)) {
            const noteId = parseInt(highlightElement.getAttribute('data-note-id'));
            const note = notes.find(n => n.id === noteId);

            if (note) {
                // 如果有笔记内容，直接显示笔记详情弹窗
                if (note.note_content) {
                    setSelectedNote(note);
                    setClickedHighlight(null);
                    return;
                }

                // 否则（纯划线），显示操作气泡
                const rect = highlightElement.getBoundingClientRect();
                setClickedHighlight({ note, rect });
                return;
            }
        }

        // Clear clicked highlight if clicking elsewhere
        setClickedHighlight(null);

        // 滚动模式：始终呼出菜单
        if (viewMode === 'scroll') {
            toggleControls();
            return;
        }

        const { clientX, clientY } = e;
        const { innerWidth, innerHeight } = window;

        // 中间区域 (30% - 70%) -> 呼出菜单
        const isCenterX = clientX > innerWidth * 0.3 && clientX < innerWidth * 0.7;
        const isCenterY = clientY > innerHeight * 0.3 && clientY < innerHeight * 0.7;

        if (isCenterX && isCenterY) {
            toggleControls();
            return;
        }

        const container = contentRef.current;
        if (!container) return;

        // 左右翻页模式 (h-page 有动画, instant 无动画)
        if (viewMode === 'h-page' || viewMode === 'instant') {
            // 计算每页步长：使用 getBoundingClientRect().width 获取精确小数宽度，消除亚像素和滚动条差异
            const pageStep = container.getBoundingClientRect().width;

            // 计算当前页码和目标页码
            const currentPage = Math.round(container.scrollLeft / pageStep);
            const maxScroll = container.scrollWidth - pageStep;
            const scrollBehavior = viewMode === 'instant' ? 'instant' : 'smooth';

            if (clientX < innerWidth * 0.3) {
                // 点击左侧 -> 上一页
                if (currentPage <= 0) {
                    prevChapter(true); // 到上一章末尾
                } else {
                    container.scrollTo({ left: (currentPage - 1) * pageStep, behavior: scrollBehavior });
                }
            } else {
                // 点击右侧 -> 下一页
                // 先检查当前是否已在最后一页 (使用宽松比较处理小数误差)
                if (container.scrollLeft >= maxScroll - 5) {
                    nextChapter();
                } else {
                    const targetScroll = Math.min((currentPage + 1) * pageStep, maxScroll);
                    container.scrollTo({ left: targetScroll, behavior: scrollBehavior });
                }
            }
        }
        // 上下翻页模式
        else if (viewMode === 'v-page') {
            const scrollAmount = innerHeight - 40; // 留一点重叠
            const maxScroll = container.scrollHeight - innerHeight;

            if (clientY < innerHeight * 0.3) {
                // 点击顶部 -> 上一页
                if (container.scrollTop <= 5) {
                    prevChapter(true); // 跳到上一章末尾
                } else {
                    container.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
                }
            } else {
                // 点击底部 -> 下一页
                if (container.scrollTop >= maxScroll - 5) {
                    nextChapter();
                } else {
                    container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                }
            }
        }
    };

    const prevChapter = async (toBottom = false) => {
        const curr = stateRef.current.currentChapterIndex;
        if (curr <= 0) return;

        const mode = stateRef.current.viewMode;
        const isPageMode = mode === 'h-page' || mode === 'instant' || mode === 'v-page';

        if (isPageMode) {
            const prevSlotIndex = (activeSlotId + 2) % 3; // (active - 1)
            const prevSlotData = pageSlots[prevSlotIndex];

            // 检查上一章插槽是否就绪
            if (prevSlotData && prevSlotData.index === curr - 1) {
                // 1. 切换 Active 指针
                const newActive = prevSlotIndex;
                setActiveSlotId(newActive);

                // 2. 更新逻辑状态
                const newIndex = curr - 1;
                setCurrentChapterIndex(newIndex);
                stateRef.current.currentChapterIndex = newIndex;
                setLoadedArticles([prevSlotData]); // 兼容旧逻辑

                // 3. 预加载新的 "Prev" (即原来的 Next 插槽位置)
                const newPrevSlotTargetIndex = (newActive + 2) % 3;
                const targetChapterIndex = newIndex - 1;

                if (targetChapterIndex >= 0) {
                    getChapterData(targetChapterIndex).then(data => {
                        if (data) {
                            setPageSlots(prev => {
                                const next = [...prev];
                                next[newPrevSlotTargetIndex] = { index: targetChapterIndex, content: data.content, title: data.title };
                                return next;
                            });
                        }
                    }).catch(() => { });
                } else {
                    // 没有更早的章节，清空该插槽
                    setPageSlots(prev => {
                        const next = [...prev];
                        next[newPrevSlotTargetIndex] = null;
                        return next;
                    });
                }

                // 保存进度
                // 如果是按钮点击(toBottom=false)，需要强制滚动到顶部吗？
                // 通常 prevChapter 按钮意味着"回到上一章开头"。 
                // 但是在 Slot 架构中，Prev 角色默认是滚到底部的。
                // 所以如果是按钮点击，我们需要在切换后，手动将新 Active 滚到顶部。
                if (!toBottom) {
                    // 延迟一帧等待切换完成
                    requestAnimationFrame(() => {
                        const el = slotRefs.current[newActive];
                        if (el) el.scrollTop = 0; // or scrollLeft=0
                        if (mode === 'h-page' || mode === 'instant') if (el) el.scrollLeft = 0;
                    });
                }

                const total = stateRef.current.chapters.length;
                const globalPercent = total > 0 ? parseFloat(((newIndex / total) * 100).toFixed(1)) : 0;
                setReadingProgress(globalPercent);
                saveProgress(newIndex, toBottom ? 100 : 0, globalPercent);

            } else {
                // 预加载未就绪，回退到普通加载
                loadChapter(curr - 1, false, toBottom ? 'bottom' : 0);
            }
        } else {
            // ... (Legacy Scroll Mode Logic) ...
            // 预渲染未就绪：回退到传统加载
            if (toBottom) {
                loadChapter(curr - 1, false, 'bottom');
            } else {
                loadChapter(curr - 1, false, toBottom ? 'bottom' : 0);
            }
        }
    };

    const nextChapter = async () => {
        const curr = stateRef.current.currentChapterIndex;
        if (curr >= stateRef.current.chapters.length - 1) return;

        const mode = stateRef.current.viewMode;
        const isPageMode = mode === 'h-page' || mode === 'instant' || mode === 'v-page';

        if (isPageMode) {
            const nextSlotIndex = (activeSlotId + 1) % 3;
            const nextSlotData = pageSlots[nextSlotIndex];

            // 检查下一章插槽是否就绪
            if (nextSlotData && nextSlotData.index === curr + 1) {
                // 1. 切换 Active 指针
                const newActive = nextSlotIndex;
                setActiveSlotId(newActive);

                // 2. 更新逻辑状态
                const newIndex = curr + 1;
                setCurrentChapterIndex(newIndex);
                stateRef.current.currentChapterIndex = newIndex;
                setLoadedArticles([nextSlotData]); // 兼容旧逻辑

                // 3. 预加载新的 "Next" (即原来的 Prev 插槽位置)
                const newNextSlotTargetIndex = (newActive + 1) % 3;
                const targetChapterIndex = newIndex + 1;

                if (targetChapterIndex < stateRef.current.chapters.length) {
                    getChapterData(targetChapterIndex).then(data => {
                        if (data) {
                            setPageSlots(prev => {
                                const next = [...prev];
                                next[newNextSlotTargetIndex] = { index: targetChapterIndex, content: data.content, title: data.title };
                                return next;
                            });
                        }
                    }).catch(() => { });
                } else {
                    setPageSlots(prev => { const next = [...prev]; next[newNextSlotTargetIndex] = null; return next; });
                }

                // 保存进度
                const total = stateRef.current.chapters.length;
                const globalPercent = total > 0 ? parseFloat(((newIndex / total) * 100).toFixed(1)) : 0;
                setReadingProgress(globalPercent);
                saveProgress(newIndex, 0, globalPercent);
            } else {
                loadChapter(curr + 1, false, 0);
            }
        } else {
            loadChapter(curr + 1, false, 0);
        }
    };

    // Keep refs in sync with latest function versions
    useEffect(() => {
        prevChapterRef.current = prevChapter;
        nextChapterRef.current = nextChapter;
    });

    // 初始化加载
    useEffect(() => {
        const handlePopState = (event) => {
            const state = event.state || {};

            if (isIOS && window.history.state?.fullscreen) {
                // Keep fullscreen
            } else if (isIOS && isFullscreen) {
                setIsFullscreen(false);
            } else if (document.fullscreenElement && !window.history.state?.fullscreen) {
                document.exitFullscreen().catch(() => { });
            }

            if (state.panel) {
                setActivePanel(state.panel);
                setShowControls(true);
            } else {
                setActivePanel(null);
            }

            if (state.search) {
                setShowSearch(true);
                setShowControls(true);
            } else {
                setShowSearch(false);
            }
        };
        window.addEventListener('popstate', handlePopState);

        const initReader = async () => {
            // Token 恢复逻辑 (针对 iOS PWA 情况)
            if (!token) {
                try {
                    const verifyRes = await apiGet('/api/auth/verify');
                    if (verifyRes.ok) {
                        const data = await verifyRes.json();
                        // 恢复 token 并刷新页面状态 (虽然这里是函数内变量，但后续请求会用到)
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('user', JSON.stringify(data.user));
                        // 重新加载页面以应用新 Token (简单粗暴但有效，避免变量混淆)
                        window.location.reload();
                        return;
                    }
                } catch (e) {
                    console.error('Auto-login failed', e);
                }
                navigate('/');
                return;
            }

            try {
                // 0. 设置和字体已由 App.jsx 预加载，这里仅确保同步最新状态
                const ua = navigator.userAgent.toLowerCase();
                const currentDeviceType = /iphone|ipad|ipod|android|mobile/.test(ua) ? 'mobile' : 'desktop';

                try {
                    // 检查本地是否有缓存设置
                    let cachedFontSize = parseInt(localStorage.getItem('reader_fontSize'));
                    let cachedLineHeight = parseFloat(localStorage.getItem('reader_lineHeight'));
                    let cachedMarginH = parseInt(localStorage.getItem('reader_marginH'));
                    let cachedMarginV = parseInt(localStorage.getItem('reader_marginV'));
                    let cachedTheme = localStorage.getItem('reader_theme');
                    let cachedFontFamily = localStorage.getItem('reader_fontFamily');
                    let cachedTextAlign = localStorage.getItem('reader_textAlign');
                    let cachedViewMode = localStorage.getItem('reader_viewMode');

                    // 如果本地没有缓存，直接从服务器获取（新设备首次访问）
                    const hasLocalCache = cachedFontSize || cachedTheme || cachedViewMode;
                    if (!hasLocalCache) {
                        console.log('No local settings cache, fetching from server...');
                        try {
                            const settingsRes = await apiGet(`/api/preferences/reader/settings/${currentDeviceType}`);
                            if (settingsRes.ok) {
                                const serverSettings = await settingsRes.json();
                                // 应用服务器设置并缓存到本地
                                if (serverSettings.fontSize) { cachedFontSize = serverSettings.fontSize; localStorage.setItem('reader_fontSize', serverSettings.fontSize); }
                                if (serverSettings.lineHeight) { cachedLineHeight = serverSettings.lineHeight; localStorage.setItem('reader_lineHeight', serverSettings.lineHeight); }
                                if (serverSettings.marginH !== undefined) { cachedMarginH = serverSettings.marginH; localStorage.setItem('reader_marginH', serverSettings.marginH); }
                                if (serverSettings.marginV !== undefined) { cachedMarginV = serverSettings.marginV; localStorage.setItem('reader_marginV', serverSettings.marginV); }
                                if (serverSettings.theme) { cachedTheme = serverSettings.theme; localStorage.setItem('reader_theme', serverSettings.theme); }
                                if (serverSettings.fontFamily) { cachedFontFamily = serverSettings.fontFamily; localStorage.setItem('reader_fontFamily', serverSettings.fontFamily); }
                                if (serverSettings.textAlign) { cachedTextAlign = serverSettings.textAlign; localStorage.setItem('reader_textAlign', serverSettings.textAlign); }
                                if (serverSettings.viewMode) { cachedViewMode = serverSettings.viewMode; localStorage.setItem('reader_viewMode', serverSettings.viewMode); }
                                console.log('Settings loaded from server:', serverSettings);
                            }
                        } catch (e) {
                            console.error('Failed to fetch settings from server:', e);
                        }
                    }

                    if (cachedFontSize) setFontSize(cachedFontSize);
                    if (cachedLineHeight) setLineHeight(cachedLineHeight);
                    if (cachedMarginH) setMarginH(cachedMarginH);
                    if (cachedMarginV) setMarginV(cachedMarginV);
                    if (cachedTheme) setTheme(cachedTheme);
                    if (cachedFontFamily) setFontFamily(cachedFontFamily);
                    if (cachedTextAlign) setTextAlign(cachedTextAlign);
                    if (cachedViewMode) setViewMode(cachedViewMode);

                    // 从 IndexedDB 缓存获取已加载的字体名称列表
                    let fontNames = await getLoadedCustomFontNames();
                    setCustomFonts(fontNames);
                    console.log(`Loaded ${fontNames.length} fonts from local cache`);

                    // 懒加载：获取服务器字体列表（只是元数据，不下载实际文件）
                    try {
                        const serverFontList = await getServerFontList();
                        setServerFonts(serverFontList);
                        console.log(`Server has ${serverFontList.length} fonts available for on-demand download`);

                        // 如果当前选中的字体是自定义字体且不在本地缓存，按需下载
                        const currentFont = cachedFontFamily || fontFamily;
                        if (currentFont &&
                            currentFont !== 'sans' &&
                            currentFont !== 'serif' &&
                            currentFont !== 'default' &&
                            !fontNames.includes(currentFont)) {

                            const serverFont = serverFontList.find(f => f.name === currentFont);
                            if (serverFont) {
                                console.log(`Current font "${currentFont}" not in cache, downloading...`);
                                const success = await downloadFontOnDemand(currentFont, serverFont.url);
                                if (success) {
                                    setCustomFonts(prev => [...prev, currentFont]);
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Failed to get server font list:', e);
                    }
                } catch (settingsErr) {
                    console.error('Failed to sync settings:', settingsErr);
                }
                setSettingsLoaded(true);

                // 1. Fetch Progress First (Always fetch fresh)
                const progressRes = await apiGet(`/api/books/${bookId}/progress`)
                    .then(res => res.ok ? res.json() : null);

                if (progressRes?.in_bookshelf) setInBookshelf(progressRes.in_bookshelf == 1);

                // 2. Check Local Cache for TOC
                const cachedKey = `reader_toc_${bookId}`;
                const isInBookshelf = progressRes?.in_bookshelf == 1;
                const cachedData = localStorage.getItem(cachedKey);
                let tocData = null;

                // 仅书架书籍使用缓存跳过解析，非书架书籍每次重新解析
                if (isInBookshelf && cachedData) {
                    try {
                        const parsed = JSON.parse(cachedData);
                        if (parsed.data && Array.isArray(parsed.data.toc) && parsed.data.toc.length > 0) {
                            console.log('Using cached TOC (bookshelf book)');
                            tocData = parsed.data;
                            setLoading(false);
                        } else {
                            localStorage.removeItem(cachedKey);
                        }
                    } catch (e) {
                        localStorage.removeItem(cachedKey);
                    }
                }

                // 3. Cache Miss - Fetch from Server (Stream Support)
                if (!tocData) {
                    setReaderError('');
                    setLoading(true);
                    setLoadingProgress(0);
                    setLoadingMessage('正在建立连接...');

                    const res = await apiGet(`/api/books/${bookId}/toc?stream=true`);

                    if (!res.ok) throw new Error('无法加载目录');

                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    const processLine = (line) => {
                        if (!line.trim()) return;
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.type === 'progress') {
                                    setLoadingProgress(data.percent);
                                    setLoadingMessage(data.message || '正在解析...');
                                } else if (data.type === 'complete') {
                                    tocData = data;
                                } else if (data.type === 'error') {
                                    throw new Error(data.error);
                                }
                            } catch (e) {
                                if (e.message !== 'Unexpected end of JSON input' && line.includes('"type":"error"')) throw e;
                            }
                        }
                    };

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            buffer += decoder.decode();
                            if (buffer.trim()) buffer.split('\n\n').forEach(line => processLine(line.trim()));
                            break;
                        }
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n\n');
                        buffer = lines.pop();
                        for (const line of lines) processLine(line);
                        if (tocData) break;
                    }

                    if (!tocData) throw new Error('数据加载中断');

                    // Cache TOC (all books cache, but only bookshelf books use it to skip parsing)
                    try {
                        localStorage.setItem(cachedKey, JSON.stringify({
                            timestamp: Date.now(),
                            data: tocData
                        }));
                    } catch (e) { console.warn('Cache failed', e); }
                }

                // 4. Apply Data
                if (tocData) {
                    setBookTitle(tocData.title || 'Untitled');
                    setChapters(tocData.toc || []);
                    const fmt = tocData.format || 'txt';
                    setBookFormat(fmt);

                    // Update Ref
                    stateRef.current.chapters = tocData.toc || [];
                    stateRef.current.bookFormat = fmt;

                    const totalChapters = (tocData.toc || []).length;
                    let initialIndex = 0;
                    let chapterPercent = 0;

                    // 恢复逻辑：使用 chapter_percent + anchor_text 进行精确校准
                    if (progressRes) {
                        const savedIndex = Number.isInteger(progressRes.chapter_index) ? progressRes.chapter_index : 0;
                        initialIndex = savedIndex;
                        chapterPercent = progressRes.chapter_percent || 0;

                        // 边界检查
                        if (initialIndex >= totalChapters) {
                            initialIndex = totalChapters - 1;
                        }
                        if (initialIndex < 0) initialIndex = 0;

                        const savedTitle = typeof progressRes.chapter_title === 'string'
                            ? progressRes.chapter_title.trim().replace(/\s+/g, ' ')
                            : '';
                        if (savedTitle && ['epub', 'mobi', 'azw3'].includes(fmt) && totalChapters > 0) {
                            const matchedIndexes = [];
                            for (let i = 0; i < totalChapters; i++) {
                                const title = typeof tocData.toc?.[i]?.title === 'string'
                                    ? tocData.toc[i].title.trim().replace(/\s+/g, ' ')
                                    : '';
                                if (title === savedTitle) {
                                    matchedIndexes.push(i);
                                }
                            }
                            if (matchedIndexes.length === 1) {
                                initialIndex = matchedIndexes[0];
                            } else if (matchedIndexes.length > 1) {
                                initialIndex = matchedIndexes.reduce((best, idx) =>
                                    Math.abs(idx - savedIndex) < Math.abs(best - savedIndex) ? idx : best, matchedIndexes[0]);
                            }
                        }
                    }

                    // 更新 ref
                    progressRef.current = {
                        index: initialIndex,
                        chapterPercent: chapterPercent,
                        globalPercent: progressRes?.progress_percent || 0,
                        anchorText: progressRes?.anchor_text || null
                    };

                    if (fmt === 'pdf' || ['cbz', 'cbr', 'zip', 'cb7', '7z', 'rar', 'comic'].includes(fmt)) {
                        // PDF 和漫画格式使用专用阅读器 (ImageReader)，不需要调用 loadChapter
                        if (fmt === 'pdf') {
                            const pdfPage = initialIndex > 0 ? initialIndex : 1;
                            setPageNumber(pdfPage);
                        }
                        setLoading(false);
                    } else {
                        // 验证索引
                        if (initialIndex >= totalChapters) initialIndex = 0;

                        setCurrentChapterIndex(initialIndex);
                        stateRef.current.currentChapterIndex = initialIndex;

                        // 加载章节并恢复到章节内百分比位置 + 锚点修正
                        setLoadingMessage('正在加载章节内容...');
                        const restoreTarget = chapterPercent > 0 || progressRes?.anchor_text ? {
                            chapterPercent,
                            anchorText: progressRes?.anchor_text
                        } : 0;
                        loadChapter(initialIndex, false, restoreTarget, true);
                    }
                }
            } catch (e) {
                console.error(e);
                setLoading(false);
                setIsInitialRestoring(false); // 确保在错误时解除隐藏
                setReaderError(`加载失败: ${e.message}`);
            }
        };
        initReader();

        return () => window.removeEventListener('popstate', handlePopState);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId]);

    const toggleControls = () => {
        if (showControls && (activePanel || showSearch)) {
            window.history.back();
            setShowControls(false);
        }
        else setShowControls(!showControls);
    };

    // 设置同步到服务器的防抖定时器
    const settingsSyncRef = useRef(null);

    const updateSetting = async (key, value) => {
        // 更新本地状态和 localStorage
        switch (key) {
            case 'fontSize': setFontSize(value); localStorage.setItem('reader_fontSize', value); break;
            case 'lineHeight': setLineHeight(value); localStorage.setItem('reader_lineHeight', value); break;
            case 'marginH': setMarginH(value); localStorage.setItem('reader_marginH', value); break;
            case 'marginV': setMarginV(value); localStorage.setItem('reader_marginV', value); break;
            case 'theme': setTheme(value); localStorage.setItem('reader_theme', value); break;
            case 'viewMode':
                // 切换前保存当前位置百分比
                const currentPercent = progressRef.current.chapterPercent || 0;
                setViewMode(value);
                localStorage.setItem('reader_viewMode', value);

                // 切换到翻页模式时初始化预渲染
                const isPageMode = value === 'h-page' || value === 'instant' || value === 'v-page';
                if (isPageMode) {
                    // 初始化插槽: Slot 0=Curr, Slot 1=Next, Slot 2=Prev
                    const currIdx = stateRef.current.currentChapterIndex;
                    const initialSlots = [null, null, null];

                    // 尝试从当前已加载文章中获取数据
                    const currentArticle = loadedArticles.find(a => a.index === currIdx);
                    if (currentArticle) {
                        initialSlots[0] = { index: currIdx, content: currentArticle.content, title: currentArticle.title || chapters[currIdx]?.title };
                        setPageSlots(initialSlots);
                        setActiveSlotId(0); // 重置为 Slot 0

                        // 异步填充 Next/Prev
                        if (currIdx < stateRef.current.chapters.length - 1) {
                            getChapterData(currIdx + 1).then(d => { if (d) setPageSlots(prev => { const n = [...prev]; n[1] = { index: currIdx + 1, content: d.content, title: d.title }; return n; }); }).catch(() => { });
                        }
                        if (currIdx > 0) {
                            getChapterData(currIdx - 1).then(d => { if (d) setPageSlots(prev => { const n = [...prev]; n[2] = { index: currIdx - 1, content: d.content, title: d.title }; return n; }); }).catch(() => { });
                        }
                    } else {
                        // 如果没有数据，强制重新加载
                        loadChapter(currIdx, false, 0);
                    }
                }

                // 在下一帧恢复位置（等待布局重新计算）
                setTimeout(() => {
                    requestAnimationFrame(() => {
                        if (contentRef.current && currentPercent > 0) {
                            const container = contentRef.current;
                            const isHorizontal = value === 'h-page' || value === 'instant';

                            if (isHorizontal) {
                                // 横向模式：根据百分比计算目标页
                                const pageStep = container.getBoundingClientRect().width;
                                const totalPages = Math.ceil(container.scrollWidth / pageStep);
                                const targetPage = Math.round((currentPercent / 100) * Math.max(totalPages - 1, 1));
                                container.scrollTo({ left: targetPage * pageStep, behavior: 'instant' });
                            } else {
                                // 纵向模式：根据百分比计算 scrollTop
                                const scrollable = container.scrollHeight - container.clientHeight;
                                const targetTop = Math.round((currentPercent / 100) * scrollable);
                                container.scrollTo({ top: targetTop, behavior: 'instant' });
                            }
                        }
                    });
                }, 50); // 等待样式切换完成
                break;
            case 'fontFamily':
                // 懒加载：如果是自定义字体且不在本地缓存中，按需下载
                if (value !== 'sans' && value !== 'serif' && value !== 'default') {
                    const isInCache = customFonts.includes(value);
                    if (!isInCache) {
                        // 从服务器字体列表查找并下载
                        const serverFont = serverFonts.find(f => f.name === value);
                        if (serverFont) {
                            showToast.info(`正在下载字体: ${value}`);
                            const success = await downloadFontOnDemand(value, serverFont.url);
                            if (success) {
                                setCustomFonts(prev => [...prev, value]);
                                showToast.success(`字体 "${value}" 已下载`);
                            } else {
                                showToast.error(`下载字体失败: ${value}`);
                                return; // 下载失败，不切换字体
                            }
                        }
                    }
                }
                setFontFamily(value);
                localStorage.setItem('reader_fontFamily', value);
                break;
            case 'textAlign': setTextAlign(value); localStorage.setItem('reader_textAlign', value); break;
        }

        // 防抖同步到服务器
        if (settingsSyncRef.current) clearTimeout(settingsSyncRef.current);
        settingsSyncRef.current = setTimeout(() => {
            const settings = {
                fontSize: parseInt(localStorage.getItem('reader_fontSize')) || 18,
                lineHeight: parseFloat(localStorage.getItem('reader_lineHeight')) || 2.0,
                marginH: parseInt(localStorage.getItem('reader_marginH')) || 20,
                marginV: parseInt(localStorage.getItem('reader_marginV')) || 40,
                theme: localStorage.getItem('reader_theme') || 'light',
                fontFamily: localStorage.getItem('reader_fontFamily') || 'sans',
                textAlign: localStorage.getItem('reader_textAlign') || 'justify',
                viewMode: localStorage.getItem('reader_viewMode') || 'instant'
            };

            apiPut(`/api/preferences/reader/settings/${deviceType}`, settings)
                .catch(err => console.error('Failed to sync settings:', err));
        }, 1500);
    };

    const handleAddToBookshelf = async () => {
        // 乐观更新
        setInBookshelf(true);
        showToast.success('已加入书架');
        sessionStorage.removeItem('library_books_cache');
        window.dispatchEvent(new CustomEvent('library-refresh', { detail: { action: 'add', books: [{ id: bookId, in_bookshelf: 1 }] } }));

        try {
            const res = await apiPost(`/api/books/bookshelf/${bookId}`);
            if (!res.ok) showToast.error('加入书架失败');
        } catch (e) { console.error(e); }
    };

    const handleRemoveFromBookshelf = async () => {
        setShowRemoveDialog(true);
    };

    const confirmRemoveFromBookshelf = async () => {
        // 乐观更新
        setInBookshelf(false);
        setShowRemoveDialog(false);
        showToast.success('已移出书架');
        sessionStorage.removeItem('library_books_cache');
        window.dispatchEvent(new CustomEvent('library-refresh', { detail: { action: 'remove', bookIds: [bookId] } }));

        try {
            const res = await apiDelete(`/api/books/bookshelf/${bookId}`);
            if (!res.ok) showToast.error('移出书架失败');
        } catch (e) { console.error(e); }
    };

    const togglePanel = (panel) => {
        if (activePanel === panel) window.history.back();
        else {
            window.history.pushState({ panel }, '', '');
            setActivePanel(panel);
        }
    };

    const addCustomFont = () => { if (fontInputRef.current) fontInputRef.current.click(); };

    const handleFontFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 检查文件大小（限制 50MB）
        if (file.size > 50 * 1024 * 1024) {
            showToast.error('字体文件过大（最大 50MB）');
            e.target.value = '';
            return;
        }

        try {
            const fontName = file.name.split('.')[0];
            const arrayBuffer = await file.arrayBuffer();

            // 验证字体可加载
            const fontFace = new FontFace(fontName, arrayBuffer);
            await fontFace.load();
            document.fonts.add(fontFace);

            // 转换为 Base64（分块处理避免栈溢出）
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, chunk);
            }
            const base64 = btoa(binary);

            // 保存到本地 IndexedDB 缓存（即时生效）
            await cacheFont(fontName, base64);

            // 后台上传到服务器（不阻塞 UI）
            apiPost('/api/preferences/fonts', { name: fontName, data: base64 })
                .catch(err => console.error('Font upload to server failed:', err));

            // 更新本地状态
            if (!customFonts.includes(fontName)) {
                setCustomFonts(prev => [...prev, fontName]);
            }
            updateSetting('fontFamily', fontName);
            showToast.success(`字体 "${fontName}" 已加载`);
        } catch (err) {
            console.error('Font load error:', err);
            showToast.error('字体加载失败');
        }
        e.target.value = '';
    };

    // 删除自定义字体
    const deleteCustomFont = async (fontName) => {
        try {
            // 从本地缓存删除
            await removeCachedFont(fontName);

            // 后台从服务器删除
            apiDelete(`/api/preferences/fonts/${encodeURIComponent(fontName)}`)
                .catch(err => console.error('Delete font from server failed:', err));

            // 更新本地状态
            setCustomFonts(prev => prev.filter(f => f !== fontName));

            // 如果删除的是当前使用的字体，切换回默认字体
            if (fontFamily === fontName) {
                updateSetting('fontFamily', 'sans');
            }

            showToast.success(`字体 "${fontName}" 已删除`);
        } catch (err) {
            console.error('Delete font error:', err);
            showToast.error('删除字体失败');
        }
    };

    // 重命名自定义字体
    const renameCustomFont = async (oldName, newName) => {
        if (!newName || newName === oldName) {
            setFontToRename(null);
            return;
        }

        try {
            // 获取字体数据
            const cachedFonts = await getCachedFonts();
            const fontData = cachedFonts.find(f => f.name === oldName);
            if (!fontData) {
                showToast.error('未找到字体数据');
                return;
            }

            // 用新名称保存
            await cacheFont(newName, fontData.data);
            await removeCachedFont(oldName);

            // 注册新名称的字体
            await registerFont(newName, fontData.data);

            // 后台从服务器删除
            apiDelete(`/api/preferences/fonts/${encodeURIComponent(oldName)}`)
                .catch(console.error);

            apiPost('/api/preferences/fonts', { name: newName, data: fontData.data })
                .catch(console.error);

            // 更新本地状态
            setCustomFonts(prev => prev.map(f => f === oldName ? newName : f));

            // 如果重命名的是当前使用的字体，更新设置
            if (fontFamily === oldName) {
                updateSetting('fontFamily', newName);
            }

            setFontToRename(null);
            setNewFontName('');
            showToast.success(`字体已重命名为 "${newName}"`);
        } catch (err) {
            console.error('Rename font error:', err);
            showToast.error('重命名字体失败');
        }
    };

    // Auto-load next chapter if current is too short to scroll
    useEffect(() => {
        if (viewMode === 'scroll' && !loading && loadedArticles.length > 0) {
            const timer = setTimeout(() => {
                const container = contentRef.current;
                if (container) {
                    const { scrollHeight, clientHeight } = container;
                    if (scrollHeight - clientHeight < 500) {
                        const lastIdx = loadedArticles[loadedArticles.length - 1].index;
                        if (lastIdx < stateRef.current.chapters.length - 1) {
                            loadChapter(lastIdx + 1, true);
                        }
                    }
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [loadedArticles, loading, viewMode]);

    // PDF Progress Auto-Save
    const debouncedPageNumber = useDebounce(pageNumber, 1000);

    useEffect(() => {
        if (bookFormat === 'pdf' && numPages > 0 && debouncedPageNumber > 0) {
            const globalPercent = parseFloat(((debouncedPageNumber / numPages) * 100).toFixed(1));
            // 避免重复保存（如果已有逻辑）或在初始化时触发
            saveProgress(debouncedPageNumber, 0, globalPercent);
        }
    }, [debouncedPageNumber, bookFormat, numPages]);

    // PDF 虚拟目录
    const pdfToc = useMemo(() => {
        if (bookFormat !== 'pdf' || !numPages) return [];
        return Array.from({ length: numPages }, (_, i) => ({
            title: `第 ${i + 1} 页`,
            index: i + 1, // Store page number as index logic for PDF
            isPdfPage: true
        }));
    }, [bookFormat, numPages]);

    // Redirect to ImageReader for PDF/Comics
    if (['pdf', 'comic', 'cbr', 'cbz', 'zip'].includes(bookFormat)) {
        return (
            <ImageReader
                bookId={bookId}
                bookFormat={bookFormat}
                initialTheme={theme}
                bookTitle={bookTitle}
                onBack={handleBack}
                token={token}
            />
        );
    }

    // Text View (Unified)
    return (
        <div
            className={`${(isIOS && isFullscreen) ? 'fixed inset-0 z-[100]' : 'relative w-full h-screen'} overflow-hidden flex flex-col ${themes[theme].bg} ${themes[theme].text} transition-colors duration-300 reader-theme-${theme.replace('_', '-')}`}
            style={{
                paddingTop: (isIOS && isFullscreen) ? 'max(env(safe-area-inset-top), 20px)' : undefined
            }}
        >
            {viewMode === 'scroll' && (
                <div
                    className={`fixed top-0 left-0 right-0 z-40 pointer-events-none ${currentBgStyle}`}
                    style={{ height: 'env(safe-area-inset-top, 20px)' }}
                />
            )}


            {readerError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div
                        onClick={toggleControls}
                        className={`pointer-events-auto max-w-[80%] px-6 py-4 rounded-lg shadow-lg text-sm text-center ${isDark ? 'bg-red-500/20 text-red-200 backdrop-blur-md' : 'bg-red-50 text-red-600 shadow-sm'}`}>
                        {readerError}
                    </div>
                </div>
            )}

            {/* Empty State Click Handler for Error/Loading */}
            {(!loadedArticles.length || readerError) && bookFormat !== 'pdf' && (
                <div
                    className="absolute inset-0 z-10"
                    onClick={toggleControls}
                />
            )}

            {/* Content Area */}
            {bookFormat === 'pdf' ? (
                /* PDF Content Area */
                <div
                    className="flex-1 w-full relative overflow-auto flex justify-center p-4"
                    onClick={() => setShowControls(!showControls)} // Toggle controls on click
                    style={{ backgroundColor: themes[theme].bg === 'bg-white' ? '#F3F4F6' : undefined }} // Keep light gray bg for PDF in light mode for contrast
                >
                    {!loading && (
                        <Document
                            file={pdfFileObj}
                            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                            loading={<div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-gray-400 w-8 h-8" /></div>}
                            className="flex flex-col items-center min-h-full justify-center"
                        >
                            <Page
                                pageNumber={pageNumber}
                                scale={pdfScale}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                                className="shadow-lg rounded-lg overflow-hidden"
                                width={window.innerWidth > 0 ? Math.min(window.innerWidth - 32, 800) : undefined}
                            />
                        </Document>
                    )}
                </div>
            ) : (
                /* Text/EPUB Content Area */
                /* Text/EPUB Content Area */
                (viewMode === 'h-page' || viewMode === 'instant' || viewMode === 'v-page') ? (
                    // ------------------ 轮转插槽架构 (3 Slots) ------------------
                    <>
                        {[0, 1, 2].map(slotIndex => {
                            const role = getSlotRole(slotIndex, activeSlotId); // 'current', 'next', 'prev'
                            const isActive = role === 'current';
                            const slotData = pageSlots[slotIndex];

                            return (
                                <div
                                    key={slotIndex}
                                    ref={el => {
                                        slotRefs.current[slotIndex] = el;
                                        if (isActive) contentRef.current = el; // 关键：将 contentRef 指向当前活动插槽，以支持点击和滚动逻辑
                                    }}
                                    className={`absolute top-0 left-0 w-full h-full 
                                        ${isActive ? 'z-10 opacity-100' : 'z-0 opacity-0 pointer-events-none invisible'} 
                                        ${(viewMode === 'h-page' || viewMode === 'instant') ? 'overflow-hidden' : 'overflow-y-auto no-scrollbar'}`}
                                    // 仅 Active 插槽响应事件
                                    onClick={isActive ? handleContentClick : undefined}
                                    onTouchStart={isActive ? handleTouchStart : undefined}
                                    onTouchMove={isActive ? handleTouchMove : undefined}
                                    onTouchEnd={isActive ? handleTouchEnd : undefined}
                                    onScroll={isActive ? handleScroll : undefined}
                                    onWheel={isActive ? handleWheel : undefined}
                                    style={{
                                        paddingTop: `${marginV}px`,
                                        paddingBottom: (viewMode === 'h-page' || viewMode === 'instant') ? '16px' : `${marginV}px`,
                                        fontSize: `${fontSize}px`,
                                        lineHeight: lineHeight,
                                        textAlign: textAlign,
                                        fontFamily: fontFamily === 'serif' ? '"Merriweather", serif' :
                                            fontFamily === 'sans' ? 'system-ui, sans-serif' :
                                                `"${fontFamily}", sans-serif`,
                                        WebkitTouchCallout: 'none', // 禁用 iOS 长按菜单
                                        userSelect: isActive ? 'text' : 'none', // 仅允许当前页选择文本，防止跨页选择
                                        WebkitUserSelect: isActive ? 'text' : 'none',
                                        ...((viewMode === 'h-page' || viewMode === 'instant') ? {
                                            scrollbarWidth: 'none',
                                            msOverflowStyle: 'none',
                                            WebkitOverflowScrolling: 'touch',
                                            columnWidth: '100vw', // 强制只用视口宽度，避免 calc 的亚像素差异
                                            columnGap: 0,
                                            columnFill: 'auto',
                                            height: '100vh',
                                            width: '100vw',
                                            paddingLeft: 0, paddingRight: 0,
                                            boxSizing: 'border-box',
                                            overscrollBehavior: 'none',
                                        } : {
                                            overscrollBehavior: 'none'
                                        })
                                    }}
                                >
                                    {slotData && (
                                        <div className="chapter-article w-full max-w-[960px] mx-auto mb-4"
                                            data-index={slotData.index}
                                            style={{ paddingLeft: `${marginH}px`, paddingRight: `${marginH}px` }}>
                                            <h2 className="text-2xl font-bold mb-8 opacity-40 text-center pt-8">{slotData.title || chapters[slotData.index]?.title}</h2>

                                            <div
                                                key={`${slotData.index}-${notes.length}`}
                                                className={`break-words ${['epub', 'mobi', 'azw3'].includes(bookFormat) ? '' : 'whitespace-pre-wrap'}`}
                                                dangerouslySetInnerHTML={{
                                                    __html: (function () {
                                                        const isEpub = ['epub', 'mobi', 'azw3'].includes(bookFormat);
                                                        let html = '';

                                                        if (isEpub) {
                                                            html = slotData.content || '';
                                                            if (theme === 'light') {
                                                                html = normalizeLightThemeEpubInlineColors(html);
                                                            }
                                                        } else {
                                                            // TXT: clean and escape HTML
                                                            let text = getCleanContent(slotData.content, slotData.title || chapters[slotData.index]?.title);
                                                            // Simple HTML escape
                                                            html = text
                                                                .replace(/&/g, "&amp;")
                                                                .replace(/</g, "&lt;")
                                                                .replace(/>/g, "&gt;")
                                                                .replace(/"/g, "&quot;")
                                                                .replace(/'/g, "&#039;");
                                                        }

                                                        // 1. Apply User Highlights
                                                        const chapterNotes = notes.filter(n => n.chapter_index === slotData.index);
                                                        // Sort by text length descending
                                                        chapterNotes.sort((a, b) => b.text_content.length - a.text_content.length);

                                                        chapterNotes.forEach(note => {
                                                            if (!note.text_content) return;
                                                            try {
                                                                let matchText = note.text_content;
                                                                // If TXT, the content (html) is escaped, so we must escape the search key too
                                                                if (!isEpub) {
                                                                    matchText = matchText
                                                                        .replace(/&/g, "&amp;")
                                                                        .replace(/</g, "&lt;")
                                                                        .replace(/>/g, "&gt;")
                                                                        .replace(/"/g, "&quot;")
                                                                        .replace(/'/g, "&#039;");
                                                                }

                                                                // Escape regex special chars
                                                                const safeText = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                                                const regex = new RegExp(`(<[^>]+>)|(${safeText})`, 'g');

                                                                let matchCount = 0;
                                                                // Default to 0 (first occurrence) if range_start is missing, for backward compatibility
                                                                const targetIndex = note.range_start !== undefined ? note.range_start : 0;

                                                                html = html.replace(regex, (match, tag, text) => {
                                                                    if (tag) return tag; // Skip tags

                                                                    // Only highlight the specific occurrence
                                                                    if (matchCount === targetIndex) {
                                                                        matchCount++;

                                                                        let className = 'user-highlight cursor-pointer transition-colors ';
                                                                        if (note.style === 'underline') className += 'border-b-2 border-blue-400 ';
                                                                        else if (note.style === 'wavy') className += 'border-b-2 border-red-400 border-dotted ';
                                                                        else {
                                                                            if (note.note_content) {
                                                                                if (isDark) className += 'bg-purple-600/40 hover:bg-purple-600/60 ';
                                                                                else className += 'bg-purple-200/50 hover:bg-purple-200/70 ';
                                                                            } else {
                                                                                if (isDark) className += 'bg-yellow-600/40 hover:bg-yellow-600/60 ';
                                                                                else className += 'bg-yellow-200/50 hover:bg-yellow-200/70 ';
                                                                            }
                                                                        }

                                                                        if (note.note_content) className += 'border-b-2 border-yellow-500/50 ';

                                                                        return `<span class="${className}" data-note-id="${note.id}">${text}</span>`;
                                                                    }

                                                                    matchCount++;
                                                                    return text;
                                                                });
                                                            } catch (e) {
                                                                console.warn('Highlight failed for note:', note, e);
                                                            }
                                                        });

                                                        // 2. Apply Search Highlight
                                                        if (showSearch && searchQuery) {
                                                            try {
                                                                let matchQuery = searchQuery;
                                                                if (!isEpub) {
                                                                    matchQuery = matchQuery
                                                                        .replace(/&/g, "&amp;")
                                                                        .replace(/</g, "&lt;")
                                                                        .replace(/>/g, "&gt;")
                                                                        .replace(/"/g, "&quot;")
                                                                        .replace(/'/g, "&#039;");
                                                                }
                                                                const regex = new RegExp(`(<[^>]+>)|(${escapeRegExp(matchQuery)})`, 'gi');
                                                                html = html.replace(regex, (match, tag, text) => {
                                                                    if (tag) return tag;
                                                                    return `<span class="search-match bg-yellow-300 text-black">${text}</span>`;
                                                                });
                                                            } catch (e) { }
                                                        }

                                                        return html;
                                                    })()
                                                }} />
                                        </div>
                                    )}

                                    {/* 全书完标记 (仅在最后一章显示) */}
                                    {slotData && slotData.index >= chapters.length - 1 && (
                                        <div className="h-32 flex items-center justify-center text-sm opacity-30">— 全书完 —</div>
                                    )}
                                </div>
                            );
                        })}
                    </>
                ) : (
                    // ------------------ 单容器架构 (Scroll Mode / Fallback) ------------------
                    <div
                        ref={contentRef}
                        className={`flex-1 overflow-y-auto no-scrollbar`}
                        onClick={handleContentClick}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onScroll={handleScroll}
                        onWheel={handleWheel}
                        style={{
                            paddingTop: `${marginV}px`,
                            paddingBottom: `${marginV}px`,
                            fontSize: `${fontSize}px`,
                            lineHeight: lineHeight,
                            textAlign: textAlign,
                            visibility: isInitialRestoring ? 'hidden' : 'visible',
                            opacity: isInitialRestoring ? 0 : 1,
                            transition: isInitialRestoring ? 'none' : 'opacity 0.2s ease-out',
                            fontFamily: fontFamily === 'serif' ? '"Merriweather", serif' :
                                fontFamily === 'sans' ? 'system-ui, sans-serif' :
                                    `"${fontFamily}", sans-serif`,
                            overscrollBehavior: 'none',
                            WebkitTouchCallout: 'none', // 禁用 iOS 长按菜单
                        }}
                    >
                        {loadedArticles.map((article) => (
                            <div
                                key={article.index}
                                className="mb-16 chapter-article w-full max-w-[960px] mx-auto"
                                data-index={article.index}
                                style={{ paddingLeft: `${marginH}px`, paddingRight: `${marginH}px` }}
                            >
                                <h2 className="text-2xl font-bold mb-8 opacity-40 text-center pt-8">{article.title || chapters[article.index]?.title}</h2>
                                <div className={`break-words ${['epub', 'mobi', 'azw3'].includes(bookFormat) ? '' : 'whitespace-pre-wrap'}`} dangerouslySetInnerHTML={{
                                    __html: (function () {
                                        const isEpub = ['epub', 'mobi', 'azw3'].includes(bookFormat);
                                        let html = '';

                                        if (isEpub) {
                                            html = article.content || '';
                                            if (theme === 'light') {
                                                html = normalizeLightThemeEpubInlineColors(html);
                                            }
                                        } else {
                                            // TXT: clean and escape HTML
                                            let text = getCleanContent(article.content, article.title || chapters[article.index]?.title);
                                            // Simple HTML escape
                                            html = text
                                                .replace(/&/g, "&amp;")
                                                .replace(/</g, "&lt;")
                                                .replace(/>/g, "&gt;")
                                                .replace(/"/g, "&quot;")
                                                .replace(/'/g, "&#039;");
                                        }

                                        // 1. Apply User Highlights
                                        const chapterNotes = notes.filter(n => n.chapter_index === article.index);
                                        // Sort by text length descending
                                        chapterNotes.sort((a, b) => b.text_content.length - a.text_content.length);

                                        chapterNotes.forEach(note => {
                                            if (!note.text_content) return;
                                            try {
                                                let matchText = note.text_content;
                                                // If TXT, the content (html) is escaped, so we must escape the search key too
                                                if (!isEpub) {
                                                    matchText = matchText
                                                        .replace(/&/g, "&amp;")
                                                        .replace(/</g, "&lt;")
                                                        .replace(/>/g, "&gt;")
                                                        .replace(/"/g, "&quot;")
                                                        .replace(/'/g, "&#039;");
                                                }

                                                // Escape regex special chars
                                                const safeText = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                                const regex = new RegExp(`(<[^>]+>)|(${safeText})`, 'g');

                                                let matchCount = 0;
                                                // Default to 0 (first occurrence) if range_start is missing
                                                const targetIndex = note.range_start !== undefined ? note.range_start : 0;

                                                html = html.replace(regex, (match, tag, text) => {
                                                    if (tag) return tag; // Skip tags

                                                    // Only highlight the specific occurrence
                                                    if (matchCount === targetIndex) {
                                                        matchCount++;

                                                        let className = 'user-highlight cursor-pointer transition-colors ';
                                                        if (note.style === 'underline') className += 'border-b-2 border-blue-400 ';
                                                        else if (note.style === 'wavy') className += 'border-b-2 border-red-400 border-dotted ';
                                                        else {
                                                            if (note.note_content) {
                                                                if (isDark) className += 'bg-purple-600/40 hover:bg-purple-600/60 ';
                                                                else className += 'bg-purple-200/50 hover:bg-purple-200/70 ';
                                                            } else {
                                                                if (isDark) className += 'bg-yellow-600/40 hover:bg-yellow-600/60 ';
                                                                else className += 'bg-yellow-200/50 hover:bg-yellow-200/70 ';
                                                            }
                                                        }

                                                        if (note.note_content) className += 'border-b-2 border-yellow-500/50 ';

                                                        return `<span class="${className}" data-note-id="${note.id}">${text}</span>`;
                                                    }

                                                    matchCount++;
                                                    return text;
                                                });
                                            } catch (e) {
                                                console.warn('Highlight failed for note:', note, e);
                                            }
                                        });

                                        // 2. Apply Search Highlight
                                        if (showSearch && searchQuery) {
                                            try {
                                                let matchQuery = searchQuery;
                                                if (!isEpub) {
                                                    matchQuery = matchQuery
                                                        .replace(/&/g, "&amp;")
                                                        .replace(/</g, "&lt;")
                                                        .replace(/>/g, "&gt;")
                                                        .replace(/"/g, "&quot;")
                                                        .replace(/'/g, "&#039;");
                                                }
                                                const regex = new RegExp(`(<[^>]+>)|(${escapeRegExp(matchQuery)})`, 'gi');
                                                html = html.replace(regex, (match, tag, text) => {
                                                    if (tag) return tag;
                                                    return `<span class="search-match bg-yellow-300 text-black">${text}</span>`;
                                                });
                                            } catch (e) { }
                                        }

                                        return html;
                                    })()
                                }} />
                            </div>
                        ))}
                        {loading && <div className="h-32 flex items-center justify-center text-sm opacity-50">{loadingMessage}</div>}
                        {loadedArticles.length > 0 && loadedArticles[loadedArticles.length - 1].index >= chapters.length - 1 && (
                            <div className="h-32 flex items-center justify-center text-sm opacity-30">— 全书完 —</div>
                        )}
                    </div>
                )

            )}



            {/* Persistent Reading Status Footer (Flex Item) - Moved to bottom */}
            {bookFormat !== 'pdf' && !(isIOS && isFullscreen) && (
                <div
                    className={`w-full shrink-0 mt-auto ${themes[theme].bg} ${themes[theme].text} flex items-center justify-between px-4 z-30 text-[10px] select-none transition-colors duration-300 ${showControls ? 'invisible' : 'opacity-80'}`}
                    style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.3rem)', height: 'calc(1.8rem + env(safe-area-inset-bottom))' }}
                >
                    <span className="truncate max-w-[70%] opacity-75">
                        {chapters[currentChapterIndex]?.title || bookTitle}
                    </span>
                    <span className="font-mono opacity-75">
                        {readingProgress}%
                    </span>
                </div>
            )}

            {/* Top Navbar (Fullscreen Mode) */}
            <div
                className={`fixed top-0 left-0 right-0 ${currentUiStyle} border-b backdrop-blur-md shadow-sm z-50 flex items-center px-4 justify-between transition-transform duration-300 ${showControls ? 'translate-y-0' : '-translate-y-full'}`}
                style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(3.5rem + env(safe-area-inset-top))' }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <button onClick={handleBack} className={`p-2 -ml-2 rounded-full hover:bg-black/5 ${currentTextStyle}`}><ArrowLeft className="w-6 h-6" /></button>
                    {/* 修复：使用 Ref 获取标题 */}
                    <span className={`font-medium truncate max-w-[200px] text-sm ${currentTextStyle}`}>
                        {chapters[currentChapterIndex]?.title || bookTitle}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={openSearch} className={`p-2 rounded-full hover:bg-black/5 ${currentTextStyle}`}>
                        <Search className="w-5 h-5" />
                    </button>
                    <button
                        onClick={inBookshelf ? handleRemoveFromBookshelf : handleAddToBookshelf}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${inBookshelf ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                    >
                        {inBookshelf ? '移出书架' : '加入书架'}
                    </button>
                </div>
            </div>

            {/* Chapter Navigation Buttons (Floating) - Enhanced for PDF */}
            <div className={`fixed left-0 right-0 px-6 z-40 flex justify-between items-end transition-all duration-300 ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}
                style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
            >
                <button
                    onClick={(e) => { e.stopPropagation(); bookFormat === 'pdf' ? setPageNumber(p => Math.max(1, p - 1)) : prevChapter(); }}
                    disabled={bookFormat === 'pdf' ? pageNumber <= 1 : currentChapterIndex === 0}
                    className="px-6 py-2 bg-black/70 text-white backdrop-blur-md rounded-full text-sm font-medium shadow-lg disabled:opacity-30 disabled:pointer-events-none transition-transform active:scale-95 hover:bg-black/80"
                >
                    {bookFormat === 'pdf' ? '上一页' : '上一章'}
                </button>
                <div className="flex-1"></div>
                <div className="flex flex-col gap-4 items-end">
                    <button
                        onClick={(e) => { e.stopPropagation(); bookFormat === 'pdf' ? setPageNumber(p => Math.min(numPages || p, p + 1)) : nextChapter(); }}
                        disabled={bookFormat === 'pdf' ? pageNumber >= (numPages || Infinity) : currentChapterIndex >= chapters.length - 1}
                        className="px-6 py-2 bg-black/70 text-white backdrop-blur-md rounded-full text-sm font-medium shadow-lg disabled:opacity-30 disabled:pointer-events-none transition-transform active:scale-95 hover:bg-black/80"
                    >
                        {bookFormat === 'pdf' ? '下一页' : '下一章'}
                    </button>
                </div>
            </div>

            {/* Bottom Bar */}
            <div className={`fixed bottom-0 left-0 right-0 ${currentUiStyle} border-t backdrop-blur-md shadow-sm z-50 grid grid-cols-3 px-6 items-center transition-transform duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}
                style={{ paddingBottom: 'env(safe-area-inset-bottom)', height: 'calc(5rem + env(safe-area-inset-bottom))' }}
            >
                <button onClick={() => togglePanel('toc')} className={`flex flex-col items-center gap-1 ${activePanel === 'toc' ? 'text-blue-600' : 'opacity-70'}`}><List className="w-6 h-6" /><span className="text-[10px]">目录</span></button>
                <button onClick={() => togglePanel('settings')} className={`flex flex-col items-center gap-1 ${activePanel === 'settings' ? 'text-blue-600' : 'opacity-70'}`}><Settings className="w-6 h-6" /><span className="text-[10px]">设置</span></button>
                <button onClick={() => updateSetting('theme', theme === 'dark' ? 'light' : 'dark')} className="flex flex-col items-center gap-1 opacity-70"><Moon className="w-6 h-6" /><span className="text-[10px]">夜间</span></button>
            </div>

            {/* Settings Panel */}
            {showControls && activePanel === 'settings' && (
                <div className={`fixed bottom-20 left-0 right-0 ${currentUiStyle} backdrop-blur-xl rounded-t-2xl p-5 z-50 space-y-5 animate-in slide-in-from-bottom-5 border-t border-white/10 max-h-[70vh] overflow-y-auto`}>

                    {/* 1. 翻页模式 */}
                    <div className="space-y-2">
                        <span className="text-xs font-medium opacity-50 ml-1">翻页模式</span>
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { id: 'scroll', label: '滚动', icon: <AlignJustify className="w-4 h-4" /> },
                                { id: 'instant', label: '无动画', icon: <ChevronRight className="w-4 h-4" /> },
                                { id: 'h-page', label: '左右', icon: <MoveHorizontal className="w-4 h-4" /> },
                                { id: 'v-page', label: '上下', icon: <MoveVertical className="w-4 h-4" /> }
                            ].map((mode) => (
                                <button
                                    key={mode.id}
                                    onClick={() => updateSetting('viewMode', mode.id)}
                                    className={`py-3 rounded-xl text-xs font-medium flex flex-col items-center gap-1 transition-all ${viewMode === mode.id ? themes[theme].active : 'bg-black/5 opacity-60'
                                        }`}
                                >
                                    {mode.icon}
                                    {mode.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 2. 字号 & 字体间距 (同一样) */}
                    <div className="space-y-2">
                        <span className="text-xs font-medium opacity-50 ml-1">字号</span>
                        <div className="flex gap-3">
                            <div className="flex-[3] flex items-center justify-between bg-black/5 rounded-2xl p-1.5">
                                <button onClick={() => updateSetting('fontSize', Math.max(12, fontSize - 1))} className="flex-1 py-3 flex justify-center hover:bg-white/50 rounded-xl transition-colors"><Minus className="w-5 h-5 opacity-60" /></button>
                                <span className="text-sm font-medium w-16 text-center">{fontSize}</span>
                                <button onClick={() => updateSetting('fontSize', Math.min(36, fontSize + 1))} className="flex-1 py-3 flex justify-center hover:bg-white/50 rounded-xl transition-colors"><Plus className="w-5 h-5 opacity-60" /></button>
                            </div>
                            <button
                                onClick={() => setShowFontSpacingModal(true)}
                                className="flex-[2] bg-black/5 hover:bg-black/10 rounded-2xl text-sm font-medium transition-colors whitespace-nowrap px-4"
                            >
                                字体和间距
                            </button>
                        </div>
                    </div>

                    {/* 3. 背景主题 */}
                    <div className="space-y-2">
                        <span className="text-xs font-medium opacity-50 ml-1">背景</span>
                        <div className="flex gap-4 overflow-x-auto p-2 -mx-2 scrollbar-hide">
                            {Object.keys(themes).map(t => (
                                <button
                                    key={t}
                                    onClick={() => updateSetting('theme', t)}
                                    className={`w-9 h-9 rounded-full border-2 flex-shrink-0 transition-all shadow-sm ${t === theme ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-2 scale-110' : 'border-black/5 hover:scale-105'} ${themes[t].bg}`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Font & Spacing Modal */}
            {showFontSpacingModal && (
                <>
                    <div className="fixed inset-0 z-[59]" onClick={() => setShowFontSpacingModal(false)} />
                    <div className={`fixed bottom-20 left-0 right-0 ${currentUiStyle} backdrop-blur-xl rounded-t-2xl p-5 z-[60] space-y-5 animate-in slide-in-from-bottom-5 border-t border-white/10 h-[50vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center border-b border-gray-100/10 pb-2">
                            <h3 className={`font-bold text-lg ${currentTextStyle}`}>字体和间距</h3>
                            <button onClick={() => setShowFontSpacingModal(false)} className={`p-2 bg-black/5 hover:bg-black/10 rounded-full transition-colors ${currentTextStyle}`}><X className="w-5 h-5" /></button>
                        </div>

                        {/* Font Selection */}
                        <div className="space-y-3">
                            {/* Mobile: Title + Custom Button on Same Row */}
                            <div className="md:hidden flex items-center justify-between">
                                <div className={`text-xs font-bold uppercase tracking-wider opacity-60 ${currentTextStyle}`}>字体选择</div>
                                <button onClick={() => setShowFontManager(true)} className={`text-xs font-bold uppercase tracking-wider text-blue-500 flex items-center gap-1`}>
                                    <Settings className="w-3 h-3" /> 自定义
                                </button>
                            </div>
                            {/* Desktop: Title + Custom Button on Same Row */}
                            <div className="hidden md:flex items-center justify-between">
                                <div className={`text-xs font-bold uppercase tracking-wider opacity-60 ${currentTextStyle}`}>字体选择</div>
                                <button onClick={() => setShowFontManager(true)} className={`text-xs font-bold uppercase tracking-wider text-blue-500 flex items-center gap-1`}>
                                    <Settings className="w-3 h-3" /> 自定义
                                </button>
                            </div>

                            {/* Mobile: Horizontal Scroll */}
                            <div className="md:hidden overflow-x-auto no-scrollbar -mx-1 px-1">
                                <div className="flex gap-2 w-max">
                                    <button onClick={() => updateSetting('fontFamily', 'sans')} className={`px-4 py-2 text-sm rounded-lg border transition-all whitespace-nowrap ${fontFamily === 'sans' ? 'bg-blue-600 text-white' : 'bg-transparent border-black/10 opacity-80'}`}>黑体</button>
                                    <button onClick={() => updateSetting('fontFamily', 'serif')} className={`px-4 py-2 text-sm rounded-lg border font-serif transition-all whitespace-nowrap ${fontFamily === 'serif' ? 'bg-blue-600 text-white' : 'bg-transparent border-black/10 opacity-80'}`}>宋体</button>
                                    {/* 已缓存的自定义字体 */}
                                    {customFonts.map(font => (
                                        <button key={font} onClick={() => updateSetting('fontFamily', font)} className={`px-4 py-2 text-sm rounded-lg border transition-all whitespace-nowrap ${fontFamily === font ? 'bg-blue-600 text-white' : 'bg-transparent border-black/10 opacity-80'}`} style={{ fontFamily: font }}>{font}</button>
                                    ))}
                                    {/* 服务器可下载的字体（未缓存） */}
                                    {serverFonts.filter(sf => !customFonts.includes(sf.name)).map(sf => (
                                        <button key={`dl-${sf.name}`} onClick={() => updateSetting('fontFamily', sf.name)} className="px-4 py-2 text-sm rounded-lg border transition-all whitespace-nowrap bg-transparent border-dashed border-black/20 opacity-60 flex items-center gap-1">
                                            <Upload className="w-3 h-3" />
                                            {sf.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Desktop: Wrap Layout */}
                            <div className="hidden md:flex flex-wrap gap-2">
                                <button onClick={() => updateSetting('fontFamily', 'sans')} className={`px-4 py-2 text-sm rounded-lg border transition-all ${fontFamily === 'sans' ? 'bg-blue-600 text-white' : 'bg-transparent border-black/10 opacity-80'}`}>黑体</button>
                                <button onClick={() => updateSetting('fontFamily', 'serif')} className={`px-4 py-2 text-sm rounded-lg border font-serif transition-all ${fontFamily === 'serif' ? 'bg-blue-600 text-white' : 'bg-transparent border-black/10 opacity-80'}`}>宋体</button>
                                {/* 已缓存的自定义字体 */}
                                {customFonts.map(font => (
                                    <button key={font} onClick={() => updateSetting('fontFamily', font)} className={`px-4 py-2 text-sm rounded-lg border transition-all ${fontFamily === font ? 'bg-blue-600 text-white' : 'bg-transparent border-black/10 opacity-80'}`} style={{ fontFamily: font }}>{font}</button>
                                ))}
                                {/* 服务器可下载的字体（未缓存） */}
                                {serverFonts.filter(sf => !customFonts.includes(sf.name)).map(sf => (
                                    <button key={`dl-${sf.name}`} onClick={() => updateSetting('fontFamily', sf.name)} className="px-4 py-2 text-sm rounded-lg border transition-all bg-transparent border-dashed border-black/20 opacity-60 flex items-center gap-1">
                                        <Upload className="w-3 h-3" />
                                        {sf.name}
                                    </button>
                                ))}
                            </div>

                            <input type="file" ref={fontInputRef} onChange={handleFontFileChange} accept=".ttf,.otf,.woff,.woff2" className="hidden" />
                        </div>

                        {/* Spacing Sliders */}
                        <div className="space-y-6 pt-2">
                            <div className="space-y-3">
                                <div className={`flex justify-between text-xs opacity-60 ${currentTextStyle}`}><span>行距</span><span>{lineHeight.toFixed(1)}</span></div>
                                <input type="range" min="1.2" max="4.0" step="0.1" value={lineHeight} onChange={(e) => updateSetting('lineHeight', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200/50 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                            </div>
                            <div className="space-y-3">
                                <div className={`flex justify-between text-xs opacity-60 ${currentTextStyle}`}><span>左右边距</span><span>{marginH}px</span></div>
                                <input type="range" min="0" max="100" step="4" value={marginH} onChange={(e) => updateSetting('marginH', parseInt(e.target.value))} className="w-full h-2 bg-gray-200/50 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Font Manager Modal */}
            {showFontManager && (
                <>
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70]" onClick={() => setShowFontManager(false)} />
                    <div
                        className={`fixed bottom-0 left-0 right-0 mx-auto ${currentUiStyle} backdrop-blur-xl rounded-t-2xl p-5 z-[80] min-h-[50vh] max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom-5`}
                        style={{ maxWidth: deviceType === 'desktop' ? '960px' : '100%' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center border-b border-gray-100/10 pb-3 mb-4">
                            <div>
                                <h3 className={`font-bold text-lg ${currentTextStyle}`}>字体管理</h3>
                                <p className={`text-xs opacity-50 ${currentTextStyle}`}>支持 TTF/OTF/WOFF 格式，最大 50MB</p>
                            </div>
                            <button onClick={() => setShowFontManager(false)} className={`p-2 bg-black/5 hover:bg-black/10 rounded-full transition-colors ${currentTextStyle}`}><X className="w-5 h-5" /></button>
                        </div>

                        {/* Add Font Button */}
                        <button
                            onClick={() => fontInputRef.current?.click()}
                            className="w-full py-3 mb-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                            <Upload className="w-4 h-4" /> 添加本地字体
                        </button>

                        {/* Font List */}
                        <div className="space-y-2">
                            {customFonts.length === 0 ? (
                                <div className={`text-center py-8 opacity-50 ${currentTextStyle}`}>
                                    暂无自定义字体
                                </div>
                            ) : (
                                customFonts.map(font => (
                                    <div key={font} className={`flex items-center justify-between p-3 rounded-xl bg-black/5 ${currentTextStyle}`}>
                                        {fontToRename === font ? (
                                            /* Rename Mode */
                                            <div className="flex-1 flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={newFontName}
                                                    onChange={e => setNewFontName(e.target.value)}
                                                    placeholder="输入新名称"
                                                    className={`flex-1 px-3 py-1.5 rounded-lg border border-blue-300 text-sm ${theme === 'dark' || theme === 'night' ? 'bg-black/30 text-white' : 'bg-white text-black'}`}
                                                    autoFocus
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') renameCustomFont(font, newFontName);
                                                        if (e.key === 'Escape') { setFontToRename(null); setNewFontName(''); }
                                                    }}
                                                />
                                                <button
                                                    onClick={() => renameCustomFont(font, newFontName)}
                                                    className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => { setFontToRename(null); setNewFontName(''); }}
                                                    className="p-2 bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            /* Normal Mode */
                                            <>
                                                <span className="text-sm font-medium truncate flex-1" style={{ fontFamily: font }}>{font}</span>
                                                <div className="flex items-center gap-1">
                                                    {fontFamily === font && (
                                                        <span className="text-xs text-blue-500 mr-2">使用中</span>
                                                    )}
                                                    <button
                                                        onClick={() => { setFontToRename(font); setNewFontName(font); }}
                                                        className="p-2 hover:bg-black/10 rounded-lg transition-colors"
                                                        title="重命名"
                                                    >
                                                        <Edit2 className="w-4 h-4 opacity-60" />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm(`确定删除字体 "${font}" 吗？`)) {
                                                                deleteCustomFont(font);
                                                            }
                                                        }}
                                                        className="p-2 hover:bg-red-100 text-red-500 rounded-lg transition-colors"
                                                        title="删除"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Sidebar Panel (TOC & Bookmarks) */}
            {showControls && activePanel === 'toc' && (
                <>
                    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]" onClick={() => window.history.back()} />
                    <div
                        className={`fixed inset-y-0 left-0 w-3/4 max-w-xs ${currentUiStyle} backdrop-blur-xl rounded-r-2xl shadow-2xl z-[70] flex flex-col animate-in slide-in-from-left-5`}
                        style={{ paddingTop: 'env(safe-area-inset-top)' }}
                    >

                        {/* Header / Tabs */}
                        <div className="flex items-center justify-between border-b border-black/5 px-2">
                            <div className="flex-1 flex text-sm font-medium">
                                <button
                                    onClick={() => setSidebarTab('toc')}
                                    className={`flex-1 py-4 text-center border-b-2 transition-colors ${sidebarTab === 'toc' ? 'border-blue-600 text-blue-600' : 'border-transparent opacity-50'}`}
                                >
                                    目录
                                </button>
                                <button
                                    onClick={() => setSidebarTab('bookmarks')}
                                    className={`flex-1 py-4 text-center border-b-2 transition-colors ${sidebarTab === 'bookmarks' ? 'border-blue-600 text-blue-600' : 'border-transparent opacity-50'}`}
                                >
                                    书签
                                </button>
                                <button
                                    onClick={() => setSidebarTab('notes')}
                                    className={`flex-1 py-4 text-center border-b-2 transition-colors ${sidebarTab === 'notes' ? 'border-blue-600 text-blue-600' : 'border-transparent opacity-50'}`}
                                >
                                    笔记
                                </button>
                            </div>
                            <button onClick={() => window.history.back()} className="p-2 ml-2 bg-black/5 rounded-full opacity-70"><X className="w-4 h-4" /></button>
                        </div>

                        {/* Content */}
                        <div className={`flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar ${isDark ? 'scrollbar-dark' : 'scrollbar-light'}`}>
                            {sidebarTab === 'toc' ? (
                                // TOC List (Unified for PDF and others)
                                (bookFormat === 'pdf' ? pdfToc : chapters).map((c, i) => (
                                    <button
                                        key={i}
                                        ref={(bookFormat === 'pdf' ? (pageNumber === c.index) : (currentChapterIndex === i)) ? activeChapterRef : null}
                                        onClick={() => {
                                            if (bookFormat === 'pdf') {
                                                setPageNumber(c.index);
                                            } else {
                                                loadChapter(i);
                                            }
                                            window.history.back();
                                            setShowControls(false);
                                        }}
                                        className={`w-full text-left px-4 py-3 rounded-xl text-sm truncate transition-colors ${(bookFormat === 'pdf' ? (pageNumber === c.index) : (currentChapterIndex === i)) ? 'bg-blue-50 text-blue-600 font-medium' : 'hover:bg-black/5 opacity-80'}`}
                                    >
                                        {c.title}
                                    </button>
                                ))
                            ) : sidebarTab === 'bookmarks' ? (
                                // Bookmarks List
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between px-1 pb-2 border-b border-black/5 mb-2">
                                        <button
                                            onClick={addBookmark}
                                            className="text-xs px-2 py-1.5 rounded-lg bg-blue-50 text-blue-600 font-medium flex items-center gap-1 active:scale-95 transition-transform"
                                        >
                                            <Plus className="w-3 h-3" />
                                            <span>添加书签</span>
                                        </button>

                                        <div className="flex bg-black/5 rounded-lg p-0.5">
                                            <button
                                                onClick={() => setBookmarkSort('time')}
                                                className={`px-2 py-1 rounded-md text-[10px] transition-all ${bookmarkSort === 'time' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}
                                            >
                                                时间
                                            </button>
                                            <button
                                                onClick={() => setBookmarkSort('location')}
                                                className={`px-2 py-1 rounded-md text-[10px] transition-all ${bookmarkSort === 'location' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}
                                            >
                                                位置
                                            </button>
                                        </div>
                                    </div>

                                    {sortedBookmarks.length === 0 ? (
                                        <div className="p-8 text-center text-xs opacity-40">暂无书签</div>
                                    ) : (
                                        sortedBookmarks.map((b) => (
                                            <div
                                                key={b.id}
                                                className="w-full text-left px-4 py-3 rounded-xl border border-black/5 flex justify-between items-center group hover:bg-black/5 transition-colors"
                                            >
                                                <button
                                                    className="flex-1 truncate mr-2 text-left"
                                                    onClick={() => {
                                                        // Load chapter and restore scroll with anchor support
                                                        const restoreTarget = {
                                                            chapterPercent: b.chapter_percent,
                                                            anchorText: b.anchor_text
                                                        };
                                                        // Fallback to legacy scroll_top if new fields missing
                                                        if (restoreTarget.chapterPercent === undefined && b.scroll_top) {
                                                            loadChapter(b.chapter_index, false, b.scroll_top);
                                                        } else {
                                                            loadChapter(b.chapter_index, false, restoreTarget);
                                                        }
                                                        window.history.back();
                                                        setShowControls(false);
                                                    }}
                                                >
                                                    <div className="text-sm font-medium truncate opacity-80 leading-normal mb-1">
                                                        {b.text_preview || b.chapter_title || '书签'}
                                                    </div>
                                                    <div className="flex items-center justify-between text-[10px] opacity-40 font-mono">
                                                        <span>{new Date(b.created_at).toLocaleString()}</span>
                                                        {b.chapter_percent !== undefined && (
                                                            <span>{b.chapter_percent.toFixed(1)}%</span>
                                                        )}
                                                    </div>
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setBookmarkToDelete(b); }}
                                                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                // Notes List
                                <div className="space-y-2">
                                    {notes.filter(n => n.note_content || n.style).length === 0 ? (
                                        <div className="p-8 text-center text-xs opacity-40">暂无笔记或划线</div>
                                    ) : (
                                        notes.filter(n => n.note_content || n.style).map((n) => (
                                            <div
                                                key={n.id}
                                                className="w-full text-left px-4 py-3 rounded-xl border border-black/5 flex justify-between items-center group hover:bg-black/5 transition-colors"
                                            >
                                                <button
                                                    className="flex-1 truncate mr-2 text-left"
                                                    onClick={() => {
                                                        loadChapter(n.chapter_index, false, { noteId: n.id });
                                                        window.history.back();
                                                        setShowControls(false);
                                                    }}
                                                >
                                                    <div className="text-sm font-medium truncate opacity-80 leading-normal mb-1">
                                                        {n.note_content ? (
                                                            <>
                                                                <span className="font-bold mr-2">笔记:</span>
                                                                {n.note_content}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="font-bold mr-2">划线</span>
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-400 truncate mt-1">
                                                        {n.text_content}
                                                    </div>
                                                    <div className="flex items-center justify-between text-[10px] opacity-40 font-mono mt-1">
                                                        <span>{new Date(n.created_at).toLocaleString()}</span>
                                                    </div>
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteRequest(n.id, n.note_content ? 'note' : 'highlight'); }}
                                                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <style>{`
                        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                        .scrollbar-dark::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
                        .scrollbar-dark::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
                        .scrollbar-light::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
                        .scrollbar-light::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
                    `}</style>
                </>
            )}

            {/* Delete Bookmark Dialog */}
            {bookmarkToDelete && (
                <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setBookmarkToDelete(null)}>
                    <div className={`${currentUiStyle} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`} onClick={e => e.stopPropagation()}>
                        <h3 className={`text-lg font-bold mb-2 ${themes[theme].text}`}>
                            删除书签
                        </h3>
                        <p className={`text-sm mb-6 ${themes[theme].text} opacity-70 line-clamp-3`}>
                            确定要删除书签 "{bookmarkToDelete.text_preview || bookmarkToDelete.chapter_title}" 吗？
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setBookmarkToDelete(null)} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>取消</button>
                            <button onClick={confirmDeleteBookmark} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>删除</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Search Panel */}
            {showControls && showSearch && (
                <div
                    className={`fixed right-4 left-4 sm:left-auto sm:w-96 ${currentUiStyle} backdrop-blur-xl rounded-[24px] p-4 z-50 shadow-2xl animate-in slide-in-from-top-5 border border-white/10`}
                    style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
                >
                    <div className="flex items-center gap-2 border-b border-black/5 pb-3 mb-3">
                        <Search className="w-4 h-4 opacity-50" />
                        <input
                            autoFocus
                            type="text"
                            placeholder="搜索内容..."
                            className="flex-1 bg-transparent outline-none text-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') navigateSearch('next');
                            }}
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="p-1 rounded-full hover:bg-black/5">
                                <X className="w-3 h-3 opacity-50" />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center justify-between text-xs opacity-60">
                        <span>{totalMatches > 0 ? `${currentMatchIndex + 1} / ${totalMatches}` : (searchQuery ? '无结果' : '输入关键字搜索')}</span>
                        <div className="flex gap-1">
                            <button
                                onClick={() => navigateSearch('prev')}
                                disabled={totalMatches === 0}
                                className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30"
                            >
                                <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => navigateSearch('next')}
                                disabled={totalMatches === 0}
                                className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30"
                            >
                                <ChevronDown className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Remove Confirmation Dialog */}
            {showRemoveDialog && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
                    <div className={`${currentUiStyle} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}>
                        <h3 className={`text-lg font-bold mb-2 ${themes[theme].text}`}>
                            移出书架
                        </h3>
                        <p className={`text-sm mb-6 ${themes[theme].text} opacity-70`}>
                            确定要从书架移除这本书吗？
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowRemoveDialog(false)} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>取消</button>
                            <button onClick={confirmRemoveFromBookshelf} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}>确定</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Selection Menu */}
            {selection && !showNoteInput && (
                <div
                    className="fixed z-50 flex gap-1 p-1 bg-black/80 backdrop-blur-md rounded-lg shadow-xl animate-in fade-in zoom-in-95"
                    style={{
                        top: selection.rect.top - 60,
                        left: Math.min(Math.max(10, selection.rect.left + selection.rect.width / 2 - 80), window.innerWidth - 160)
                    }}
                >
                    <div className="flex items-center gap-1">
                        {!showHighlightOptions ? (
                            <>
                                <button onClick={handleCopy} className="px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 rounded-md">
                                    复制
                                </button>
                                {!selection.isInsideHighlight && (
                                    <>
                                        <div className="w-px bg-white/20 my-1 h-4" />
                                        <button onClick={() => setShowHighlightOptions(true)} className="px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 rounded-md">
                                            划线
                                        </button>
                                        <div className="w-px bg-white/20 my-1 h-4" />
                                        <button onClick={handleNote} className="px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 rounded-md">
                                            记笔记
                                        </button>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <button onClick={() => setShowHighlightOptions(false)} className="p-1.5 text-white/70 hover:bg-white/10 rounded-md mr-1">
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleHighlight('highlight')} className="p-2 text-yellow-400 hover:bg-white/10 rounded-md" title="高亮">
                                    <div className="w-4 h-4 bg-yellow-400/80 rounded-sm" />
                                </button>
                                <button onClick={() => handleHighlight('underline')} className="p-2 text-blue-400 hover:bg-white/10 rounded-md" title="下划线">
                                    <div className="w-4 h-4 border-b-2 border-blue-400" />
                                </button>
                                <button onClick={() => handleHighlight('wavy')} className="p-2 text-red-400 hover:bg-white/10 rounded-md" title="波浪线">
                                    <div className="w-4 h-4 border-b-2 border-red-400 border-dotted" />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Clicked Highlight Bubble */}
            {clickedHighlight && !showNoteInput && (
                <div
                    className="fixed z-50 flex gap-1 p-1 bg-black/80 backdrop-blur-md rounded-lg shadow-xl animate-in fade-in zoom-in-95"
                    style={{
                        top: clickedHighlight.rect.top - 50,
                        left: Math.min(Math.max(10, clickedHighlight.rect.left + clickedHighlight.rect.width / 2 - 80), window.innerWidth - 160)
                    }}
                >
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => {
                                updateNoteStyle(clickedHighlight.note.id, 'highlight');
                                setClickedHighlight(null);
                            }}
                            className={`p-2 hover:bg-white/10 rounded-md ${clickedHighlight.note.style === 'highlight' ? 'text-yellow-400 bg-white/10' : 'text-yellow-400'}`}
                            title="高亮"
                        >
                            <div className="w-4 h-4 bg-currentColor rounded-sm" />
                        </button>
                        <button
                            onClick={() => {
                                updateNoteStyle(clickedHighlight.note.id, 'underline');
                                setClickedHighlight(null);
                            }}
                            className={`p-2 hover:bg-white/10 rounded-md ${clickedHighlight.note.style === 'underline' ? 'text-blue-400 bg-white/10' : 'text-blue-400'}`}
                            title="下划线"
                        >
                            <div className="w-4 h-4 border-b-2 border-currentColor" />
                        </button>
                        <button
                            onClick={() => {
                                updateNoteStyle(clickedHighlight.note.id, 'wavy');
                                setClickedHighlight(null);
                            }}
                            className={`p-2 hover:bg-white/10 rounded-md ${clickedHighlight.note.style === 'wavy' ? 'text-red-400 bg-white/10' : 'text-red-400'}`}
                            title="波浪线"
                        >
                            <div className="w-4 h-4 border-b-2 border-currentColor border-dotted" />
                        </button>

                        <div className="w-px bg-white/20 my-1 h-4" />

                        <button
                            onClick={() => handleDeleteRequest(clickedHighlight.note.id, 'highlight')}
                            className="p-2 text-red-400 hover:bg-white/10 rounded-md"
                            title="取消划线"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Note Input Dialog */}
            {showNoteInput && (
                <div
                    className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-0"
                    style={Object.keys(visualViewportStyle).length > 0 ? visualViewportStyle : undefined}
                >
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowNoteInput(false)} />
                    <div className={`relative w-full max-w-lg ${currentUiStyle} rounded-t-2xl sm:rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95`}>
                        <h3 className="text-lg font-bold mb-3">添加笔记</h3>
                        <div className="bg-black/5 p-3 rounded-lg mb-3 text-sm opacity-70 italic line-clamp-3">
                            "{selection?.text}"
                        </div>
                        <textarea
                            autoFocus
                            value={noteInputValue}
                            onChange={e => setNoteInputValue(e.target.value)}
                            placeholder="写下你的想法..."
                            className={`w-full h-32 p-3 rounded-xl resize-none outline-none border ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-gray-200'}`}
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => setShowNoteInput(false)} className="px-4 py-2 rounded-lg hover:bg-black/5 transition-colors">取消</button>
                            <button
                                onClick={() => saveNote(selection.text, noteInputValue, 'highlight', true, selection.rangeStart)}
                                disabled={!noteInputValue.trim()}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* View Note Dialog */}
            {selectedNote && (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-0">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedNote(null)} />
                    <div className={`relative w-full max-w-lg ${currentUiStyle} rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95`}>
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                            笔记详情
                        </h3>

                        <div className="mb-6">
                            <div className="text-sm font-bold opacity-50 mb-1">原文</div>
                            <div className="p-3 bg-black/5 rounded-xl text-sm italic border-l-4 border-gray-300">
                                "{selectedNote.text_content}"
                            </div>
                        </div>

                        <div className="mb-6">
                            <div className="text-sm font-bold opacity-50 mb-1">心得</div>
                            <div className="text-base leading-relaxed whitespace-pre-wrap">
                                {selectedNote.note_content}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-black/5">
                            <button
                                onClick={() => handleDeleteRequest(selectedNote.id, 'note')}
                                className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
                            >
                                删除
                            </button>
                            <button
                                onClick={() => setSelectedNote(null)}
                                className="px-6 py-2 bg-black/5 hover:bg-black/10 rounded-lg text-sm font-medium transition-colors"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
                    <div className={`${currentUiStyle} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`} onClick={e => e.stopPropagation()}>
                        <h3 className={`text-lg font-bold mb-2 ${themes[theme].text}`}>
                            {deleteConfirmData.type === 'highlight' ? '取消划线' : '删除笔记'}
                        </h3>
                        <p className={`text-sm mb-6 ${themes[theme].text} opacity-70`}>
                            {deleteConfirmData.type === 'highlight' ? '确定要取消这段划线吗？' : '确定要删除这条笔记吗？'}
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDeleteConfirm(false)} className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}>取消</button>
                            <button
                                onClick={async () => {
                                    const success = await deleteNote(deleteConfirmData.id, true);
                                    if (success) {
                                        setShowDeleteConfirm(false);
                                        if (selectedNote && selectedNote.id === deleteConfirmData.id) setSelectedNote(null);
                                        if (clickedHighlight && clickedHighlight.note.id === deleteConfirmData.id) setClickedHighlight(null);
                                    }
                                }}
                                className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Reader;
