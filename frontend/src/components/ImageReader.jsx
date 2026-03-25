import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import {
    ArrowLeft, Settings, Moon, List, Check,
    Maximize, Minimize, ZoomIn, ZoomOut, MoveHorizontal, ArrowRight,
    BookOpen, Smartphone, Loader2, Heart
} from 'lucide-react';
import { showToast } from './Toast';
import { useReadingTime } from '../hooks/useReadingTime';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF worker (Use legacy build for better compatibility with Edge/Native)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
).toString();

const themes = {
    light: { bg: 'bg-[#F5F6F8]', text: 'text-gray-900', ui: 'bg-white/90', active: 'bg-blue-50 text-blue-600' },
    dark: { bg: 'bg-[#1a1b1e]', text: 'text-gray-200', ui: 'bg-[#25262b]/95', active: 'bg-blue-900/40 text-blue-300' },
    e_ink: { bg: 'bg-[#f5f5f0]', text: 'text-gray-800', ui: 'bg-[#f0f0e8]/95', active: 'bg-gray-200 text-gray-800' },
};

// Configure PDF.js options once
const pdfOptions = {
    cMapUrl: '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/standard_fonts/',
    useSystemFonts: false,
    disableFontFace: false,
};

console.log('PDF Options:', pdfOptions);

// 修复部分老旧 PDF 字体名乱码问题 (GBK -> Latin1 Mojibake)
const injectMojibakeFonts = () => {
    const styleId = 'pdf-mojibake-fonts';
    if (document.getElementById(styleId)) return;

    const fontMappings = {
        '\u00cb\u00ce\u00cc\u00e5': ['SimSun', 'Songti SC'], // 宋体
        '\u00d0\u00a1\u00b1\u00ea\u00cb\u00ce': ['SimSun', 'Songti SC'], // 小标宋
        '\u00ba\u00da\u00cc\u00e5': ['SimHei', 'Heiti SC'], // 黑体
        '\u00bf\u00ac\u00cc\u00e5': ['KaiTi', 'Kaiti SC'], // 楷体
        '\u00b7\u00c2\u00cb\u00ce': ['FangSong', 'FangSong SC'], // 仿宋
        '\u00c1\u00a5\u00ca\u00e9': ['LiSu', 'Baoli SC'], // 隶书
        '\u00d3\u00d7\u00d4\u00b2': ['YouYuan', 'Yuanti SC'] // 幼圆
    };

    let css = '';
    Object.entries(fontMappings).forEach(([badName, fallbacks]) => {
        const src = fallbacks.map(f => `local('${f}')`).join(', ') + `, local('SimSun')`;
        css += `
            @font-face {
                font-family: "${badName}";
                src: ${src};
            }
        `;
    });

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
};

const ImageReader = ({ bookId, bookFormat, initialTheme, bookTitle, onBack }) => {
    // --- State ---
    const [numPages, setNumPages] = useState(null);

    // Keep Screen Awake (Web Wake Lock API)
    useEffect(() => {
        let wakeLock = null;

        const requestWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    console.log('Wake Lock active');
                    wakeLock.addEventListener('release', () => {
                        console.log('Wake Lock released');
                    });
                }
            } catch (err) {
                console.warn(`${err.name}, ${err.message}`);
            }
        };

        const handleVisibilityChange = async () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                await requestWakeLock();
            }
        };

        requestWakeLock();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (wakeLock !== null) {
                wakeLock.release().catch(console.error);
                wakeLock = null;
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        injectMojibakeFonts();
    }, []);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.0);
    const [theme, setTheme] = useState(initialTheme || 'light');
    const [showControls, setShowControls] = useState(true);
    const [activePanel, setActivePanel] = useState(null); // 'toc', 'settings'
    const [loading, setLoading] = useState(true);
    const [inBookshelf, setInBookshelf] = useState(false);
    const [eInkMode, setEInkMode] = useState(() => {
        // Sync with global app_theme on init
        const globalTheme = localStorage.getItem('app_theme');
        return globalTheme === 'e-ink' || localStorage.getItem('image_reader_eink') === 'true';
    });

    // Settings - Device-specific defaults (localStorage is per-device, no sync)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    useEffect(() => {
        const handlePopState = (event) => {
            const state = event.state || {};

            if (state.panel) {
                setActivePanel(state.panel);
                setShowControls(true);
            } else {
                setActivePanel(null);
            }
        };
        window.addEventListener('popstate', handlePopState);

        const initReader = async () => {
            // Mobile Auto Fullscreen
            const ua = navigator.userAgent.toLowerCase();
            const isMobile = /iphone|ipad|ipod|android|mobile/.test(ua);
            if (isMobile && !isIOS) {
                setTimeout(() => {
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen().catch(() => { });
                    }
                }, 500);
            }
        };

        initReader();
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isIOS]);
    const [viewMode, setViewMode] = useState(() =>
        localStorage.getItem('image_reader_view_mode') || (isMobile ? 'single' : 'double')
    );
    const [direction, setDirection] = useState(() =>
        localStorage.getItem('image_reader_direction') || 'ltr'
    );
    const [fitMode, setFitMode] = useState(() =>
        localStorage.getItem('image_reader_fit_mode') || (isMobile ? 'width' : 'height')
    );
    const [renderMode, setRenderMode] = useState(() =>
        isMobile ? 'canvas' : (localStorage.getItem('image_reader_render_mode') || 'canvas')
    );
    const [showRemoveDialog, setShowRemoveDialog] = useState(false);



    // Refs
    const containerRef = useRef(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const stateRef = useRef({ pages: [] });
    const imageCacheRef = useRef(new Map()); // Cache for preloaded images

    // --- Derived State ---
    const isDark = theme === 'dark' || theme === 'night';
    const activeTheme = eInkMode ? 'e_ink' : (isDark ? 'dark' : 'light');
    const currentUiStyle = themes[activeTheme].ui;
    const currentTextStyle = themes[activeTheme].text;
    const displayTitle = bookTitle ? bookTitle.replace(/\.(pdf|zip|cbz|cbr|rar|7z)$/i, '') : '';
    const itemBorder = isDark ? 'border-white/10' : 'border-black/5';
    const itemBgHover = isDark ? 'hover:bg-white/10' : 'hover:bg-black/5';

    // 阅读时长统计
    useReadingTime(bookId, null, activeTheme);

    // --- Initialization ---
    useEffect(() => {
        const savedViewMode = localStorage.getItem('image_reader_viewMode');
        const savedDirection = localStorage.getItem('image_reader_direction');
        const savedFitMode = localStorage.getItem('image_reader_fitMode');

        if (savedViewMode) setViewMode(savedViewMode);
        else setViewMode(window.innerWidth > 768 ? 'single' : 'single');

        if (savedDirection) setDirection(savedDirection);
        if (savedFitMode) setFitMode(savedFitMode);

        const handleResize = () => {
            if (containerRef.current) {
                setContainerSize({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // --- Data Fetching (PDF & Comic) ---
    useEffect(() => {
        const fetchBookInfo = async () => {
            try {
                // Fetch book metadata (including shelf status)
                // Even for PDF, we need to know if it's in the bookshelf
                const res = await fetch(`/api/books/${bookId}/toc`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    if (data.in_bookshelf !== undefined) {
                        setInBookshelf(data.in_bookshelf);
                    }

                    if (bookFormat !== 'pdf' && data.toc && data.toc.length > 0) {
                        const pages = data.toc.map((p, i) => ({
                            index: i + 1,
                            path: p.href || p.content,
                            title: p.title
                        }));
                        setNumPages(pages.length);
                        stateRef.current.pages = pages;
                    }
                }
            } catch (e) {
                console.error('Fetch book info failed', e);
            } finally {
                if (bookFormat !== 'pdf') setLoading(false);
            }
        };

        if (bookFormat === 'pdf') {
            fetchBookInfo();
            // PDF: Don't need to fetch TOC content for rendering, just allow Document to render
            setLoading(false);
        } else {
            // Comic: Fetch TOC to get image list
            setLoading(true);
            fetchBookInfo();
        }
    }, [bookId, bookFormat]);

    // --- Progress Loading & Saving ---
    const loadProgress = useCallback(async () => {
        try {
            const res = await fetch(`/api/books/${bookId}/progress`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();

                // Sync bookshelf status from progress (more reliable than TOC)
                if (data.in_bookshelf !== undefined) {
                    setInBookshelf(data.in_bookshelf == 1 || data.in_bookshelf === true);
                }

                if (data.progress_percent > 0 && data.chapter_index > 0) {
                    setPageNumber(data.chapter_index);
                    showToast.info(`已恢复阅读进度: 第 ${data.chapter_index} 页`);
                }
            }
        } catch (e) {
            console.error('Failed to load progress', e);
        }
    }, [bookId]);

    useEffect(() => {
        loadProgress();
    }, [loadProgress]);

    // Use refs to track latest state for unmount saving
    const pageNumberRef = useRef(pageNumber);
    const numPagesRef = useRef(numPages);

    useEffect(() => {
        pageNumberRef.current = pageNumber;
        numPagesRef.current = numPages;
    }, [pageNumber, numPages]);

    const saveProgress = useCallback((pageNum, force = false) => {
        if (!pageNum || !numPagesRef.current) return;

        const total = numPagesRef.current;
        const percent = parseFloat(((pageNum / total) * 100).toFixed(1));

        const data = {
            chapter_index: pageNum,
            chapter_title: `第 ${pageNum} 页`,
            progress_percent: percent,
            force: force // Bypass backend throttling
        };

        fetch(`/api/books/${bookId}/progress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data),
            keepalive: true
        }).catch(err => console.error('Progress save failed:', err));
    }, [bookId]);

    // 空闲定时器：长时间停留在当前页面未翻页，自动保存一次进度
    const idleTimerRef = useRef(null);
    useEffect(() => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            if (pageNumberRef.current && numPagesRef.current) {
                saveProgress(pageNumberRef.current, true);
            }
        }, 3 * 60 * 1000); // 3 分钟
        return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
    }, [pageNumber, saveProgress]);

    // 后台切换保存：页面进入后台时立即保存进度
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                if (pageNumberRef.current && numPagesRef.current) {
                    saveProgress(pageNumberRef.current, true);
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [saveProgress]);

    // Save on unmount
    useEffect(() => {
        return () => {
            if (pageNumberRef.current > 1) { // Don't save if just opened (maybe) - actually safe to save
                saveProgress(pageNumberRef.current, true);
            }
        };
    }, [saveProgress]);

    // Debounce save during reading
    useEffect(() => {
        if (numPages && pageNumber > 0) {
            saveProgress(pageNumber, false);
        }
    }, [pageNumber, numPages, saveProgress]);

    // --- Image Preloading (for comics) ---
    useEffect(() => {
        if (bookFormat === 'pdf' || !numPages || stateRef.current.pages.length === 0) return;

        const preloadImage = (pageNum) => {
            if (pageNum < 1 || pageNum > numPages) return;
            const page = stateRef.current.pages[pageNum - 1];
            if (!page || imageCacheRef.current.has(pageNum)) return;

            const img = new Image();
            const imageUrl = `/api/books/${bookId}/image?path=${encodeURIComponent(page.path)}`;
            img.src = imageUrl;
            imageCacheRef.current.set(pageNum, imageUrl);
        };

        // Preload current + 2 adjacent pages in each direction
        for (let offset = -2; offset <= 2; offset++) {
            preloadImage(pageNumber + offset);
        }

        // Limit cache size to 20 pages
        if (imageCacheRef.current.size > 20) {
            const keysToDelete = [...imageCacheRef.current.keys()]
                .filter(k => Math.abs(k - pageNumber) > 5)
                .slice(0, imageCacheRef.current.size - 20);
            keysToDelete.forEach(k => imageCacheRef.current.delete(k));
        }
    }, [pageNumber, numPages, bookFormat, bookId]);

    // --- View Logic ---
    const getPageProps = () => {
        if (!containerSize.width) return {};

        const availableWidth = containerSize.width;
        const availableHeight = containerSize.height;

        if (fitMode === 'width') {
            if (viewMode === 'double') {
                return { width: (availableWidth / 2) - 4 }; // -4 for gap
            }
            return { width: availableWidth };
        }

        if (fitMode === 'height') {
            return { height: availableHeight };
        }

        return { scale: scale };
    };

    const pageProps = getPageProps();

    // --- Fullscreen Toggle ---
    const toggleFullscreen = useCallback(async () => {
        const elem = document.documentElement;
        const requestFs = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.mozRequestFullScreen || elem.msRequestFullscreen;
        const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        const isNativeFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

        const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

        if (isPWA && isIOS) {
             setShowControls(!showControls);
             return;
        }

        if (!isNativeFs) {
            try {
                if (requestFs) {
                    await requestFs.call(elem);
                    // Do not push state to history
                }
            } catch (err) { }
            setTimeout(() => {
                setShowControls(false);
                setActivePanel(null);
            }, 100);
        } else {
            try {
                if (exitFs && isNativeFs) {
                    await exitFs.call(document);
                }
            } catch (err) { }
            // Do not go back in history
        }
    }, [isIOS, showControls]);

    // --- Navigation Handlers ---
    const goToPrev = () => {
        const step = viewMode === 'double' ? 2 : 1;
        let newPage = pageNumber - step;
        if (newPage < 1) newPage = 1;
        setPageNumber(newPage);
    };

    const goToNext = () => {
        const step = viewMode === 'double' ? 2 : 1;
        let newPage = pageNumber + step;
        if (newPage > numPages) newPage = numPages;
        setPageNumber(newPage);
    };

    // Swipe Handlers
    const touchStart = useRef(null);

    const handleTouchStart = (e) => {
        touchStart.current = e.touches[0].clientX;
    };

    const handleTouchEnd = (e) => {
        if (!touchStart.current) return;
        const touchEnd = e.changedTouches[0].clientX;
        const diff = touchStart.current - touchEnd;

        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                if (direction === 'ltr') goToNext();
                else goToPrev();
            } else {
                if (direction === 'ltr') goToPrev();
                else goToNext();
            }
        }
        touchStart.current = null;
    };

    // --- Render ---

    // Generate Pages to Render
    const pagesToRender = [];
    if (numPages) {
        if (viewMode === 'single') {
            pagesToRender.push(pageNumber);
        } else {
            // Double Mode
            pagesToRender.push(pageNumber);
            if (pageNumber + 1 <= numPages) {
                pagesToRender.push(pageNumber + 1);
            }
        }
    }

    // PDF Source
    const pdfUrl = `/api/books/${bookId}/pdf_stream`;
    const pdfFile = useMemo(() => ({ url: pdfUrl, }), [pdfUrl]);

    // --- Keyboard Navigation ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (activePanel) return; // Disable when panels are open

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                // If RTL, left arrow goes next, else prev
                if (direction === 'rtl') {
                    const step = viewMode === 'double' ? 2 : 1;
                    setPageNumber(p => Math.min(numPages || p, p + step));
                } else {
                    const step = viewMode === 'double' ? 2 : 1;
                    setPageNumber(p => Math.max(1, p - step));
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                // If RTL, right arrow goes prev, else next
                if (direction === 'rtl') {
                    const step = viewMode === 'double' ? 2 : 1;
                    setPageNumber(p => Math.max(1, p - step));
                } else {
                    const step = viewMode === 'double' ? 2 : 1;
                    setPageNumber(p => Math.min(numPages || p, p + step));
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pageNumber, viewMode, direction, activePanel, numPages]);


    // renderPage Helper
    const renderPage = (pageNum) => {
        if (bookFormat === 'pdf') {
            return (
                <Page
                    pageNumber={pageNum}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    className={`shadow-lg transition-[filter] duration-300 ${eInkMode ? 'brightness-[1.1] contrast-[1.2] grayscale' : ''}`}
                    {...pageProps}
                    onLoadError={(error) => {
                        console.error(`Page ${pageNum} load error:`, error);
                        // showToast.error(`第 ${pageNum} 页加载失败`);
                    }}
                />
            );
        } else {
            // Comic Image render
            const page = stateRef.current.pages[pageNum - 1];
            if (!page) return null;

            const imageUrl = `/api/books/${bookId}/image?path=${encodeURIComponent(page.path)}`;

            // 根据 fitMode 计算样式
            let imgStyle = {
                objectFit: 'contain',
                filter: eInkMode ? 'grayscale(100%) contrast(1.2) brightness(1.1)' : 'none',
                transition: 'filter 0.3s ease'
            };

            if (fitMode === 'width') {
                imgStyle.width = viewMode === 'double' ? `${(containerSize.width / 2) - 4}px` : '100%';
                imgStyle.height = 'auto';
                imgStyle.maxHeight = '100vh';
            } else if (fitMode === 'height') {
                imgStyle.height = `${containerSize.height}px`;
                imgStyle.width = 'auto';
                imgStyle.maxWidth = '100%';
            } else {
                // custom 模式：使用缩放
                imgStyle.transform = `scale(${scale})`;
                imgStyle.transformOrigin = 'center center';
            }

            return (
                <img
                    src={imageUrl}
                    alt={`Page ${pageNum}`}
                    className="select-none block"
                    style={imgStyle}
                    draggable={false}
                />
            );
        }
    };

    return (
        <div className={`relative w-full h-screen overflow-hidden flex flex-col ${themes[isDark ? 'dark' : 'light'].bg} select-none`}>

            {/* --- Top Navbar --- */}
            <div className={`fixed top-0 left-0 right-0 h-14 ${currentUiStyle} border-b border-gray-100/10 backdrop-blur-md shadow-sm z-50 flex items-center px-4 justify-between transition-transform duration-300 ${showControls ? 'translate-y-0' : '-translate-y-full'}`}>
                <div className="flex items-center gap-2 min-w-0">
                    <button onClick={onBack} className={`p-2 -ml-2 rounded-full hover:bg-black/5 ${currentTextStyle}`}>
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                    <span className={`font-medium truncate max-w-[200px] text-sm ${currentTextStyle}`}>
                        {displayTitle}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async (e) => {
                            e.stopPropagation();
                            if (inBookshelf) {
                                setShowRemoveDialog(true);
                            } else {
                                // 乐观更新：立即更新 UI
                                setInBookshelf(true);
                                showToast.success('已加入书架');
                                sessionStorage.removeItem('library_books_cache');
                                window.dispatchEvent(new CustomEvent('library-refresh', { detail: { action: 'add', books: [{ id: bookId, in_bookshelf: 1 }] } }));
                                // 后台静默请求
                                fetch(`/api/books/bookshelf/${bookId}`, {
                                    method: 'POST',
                                    credentials: 'include'
                                }).then(res => {
                                    if (!res.ok) showToast.error('加入书架失败');
                                }).catch(() => showToast.error('网络错误'));
                            }
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${inBookshelf ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                    >
                        {inBookshelf ? '移出书架' : '加入书架'}
                    </button>
                </div>
            </div>

            {/* --- Main Content --- */}
            <div
                ref={containerRef}
                className="flex-1 w-full h-full relative overflow-auto flex items-center justify-center p-4"
                onClick={(e) => {
                    // 如果有面板打开，关闭面板
                    if (activePanel) {
                        setActivePanel(null);
                        return;
                    }

                    // 计算点击位置
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const width = rect.width;
                    const ratio = clickX / width;

                    // 左侧 25%、右侧 25% 区域触发翻页，中间 50% 切换控制栏
                    if (ratio < 0.25) {
                        // 点击左侧
                        if (direction === 'ltr') goToPrev();
                        else goToNext();
                    } else if (ratio > 0.75) {
                        // 点击右侧
                        if (direction === 'ltr') goToNext();
                        else goToPrev();
                    } else {
                        // 点击中间，切换控制栏
                        setShowControls(!showControls);
                    }
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                style={{ cursor: fitMode === 'custom' ? 'grab' : 'default' }}
            >
                {!loading && containerSize.width > 0 && (
                    bookFormat === 'pdf' ? (
                        <div className="w-full min-h-full flex items-center justify-center">
                            {renderMode === 'native' ? (
                                <iframe
                                    src={pdfFile.url}
                                    className="w-full h-full border-none bg-white"
                                    title="Native View"
                                />
                            ) : (
                                <Document
                                    file={pdfFile}
                                    options={pdfOptions}
                                    onLoadSuccess={({ numPages }) => {
                                        setNumPages(numPages);
                                        setLoading(false);
                                    }}
                                    onLoadError={(error) => {
                                        console.error('PDF Load Error:', error);
                                        // showToast.error('PDF加载失败: ' + (error.message || '未知错误'));
                                        setLoading(false);
                                        // Auto switch to native if canvas fails hard? No, let user choose.
                                    }}
                                    loading={<div className="animate-pulse text-gray-400">Loading PDF...</div>}
                                    className={`flex gap-0 ${direction === 'rtl' ? 'flex-row-reverse' : 'flex-row'} items-center justify-center shadow-2xl transition-all duration-300`}
                                >
                                    {pagesToRender.map(pageNum => (
                                        <div key={pageNum} className="relative bg-white shadow-lg">
                                            {renderPage(pageNum)}
                                        </div>
                                    ))}
                                </Document>
                            )}
                        </div>
                    ) : (
                        // Comic Render
                        <div className={`flex gap-0 ${direction === 'rtl' ? 'flex-row-reverse' : 'flex-row'} items-center justify-center shadow-2xl transition-all duration-300`}>
                            {pagesToRender.map(pageNum => (
                                <div key={pageNum} className="relative bg-white shadow-lg" style={{ minWidth: viewMode === 'double' ? '50%' : '100%', display: 'flex', justifyContent: 'center' }}>
                                    {renderPage(pageNum)}
                                </div>
                            ))}
                        </div>
                    )
                )}

                {((!numPages && loading) || loading) && (
                    <div className="flex flex-col items-center gap-2 opacity-50">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                        <span className="text-xs">Loading...</span>
                    </div>
                )}
            </div>

            {/* --- Bottom Status Bar (Page Info) --- */}
            <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/60 text-white text-xs backdrop-blur-md z-40 pointer-events-none transition-opacity duration-300 ${showControls ? 'opacity-0' : 'opacity-100'}`}>
                {pageNumber} / {numPages || '--'}
            </div>

            {/* --- Bottom Navbar --- */}
            <div className={`fixed bottom-0 left-0 right-0 h-20 ${currentUiStyle} border-t border-gray-100/10 backdrop-blur-md shadow-sm z-50 grid grid-cols-3 px-6 pb-4 items-center transition-transform duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
                <button
                    onClick={(e) => { e.stopPropagation(); setActivePanel(activePanel === 'toc' ? null : 'toc'); }}
                    className={`flex flex-col items-center gap-1 ${activePanel === 'toc' ? 'text-blue-500' : 'opacity-70'} ${currentTextStyle}`}
                >
                    <List className="w-6 h-6" />
                    <span className="text-[10px]">目录</span>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); setActivePanel(activePanel === 'settings' ? null : 'settings'); }}
                    className={`flex flex-col items-center gap-1 ${activePanel === 'settings' ? 'text-blue-500' : 'opacity-70'} ${currentTextStyle}`}
                >
                    <Settings className="w-6 h-6" />
                    <span className="text-[10px]">设置</span>
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        const newMode = !eInkMode;
                        setEInkMode(newMode);
                        localStorage.setItem('image_reader_eink', String(newMode));
                        if (newMode) showToast.info('已开启墨水屏模式');
                        else showToast.info('已关闭墨水屏模式');
                    }}
                    className={`flex flex-col items-center gap-1 ${eInkMode ? 'text-blue-500' : 'opacity-70'} ${currentTextStyle}`}
                >
                    <Smartphone className="w-6 h-6" />
                    <span className="text-[10px]">墨水屏</span>
                </button>
            </div>

            {/* --- Settings Panel --- */}
            {showControls && activePanel === 'settings' && (
                <div
                    className={`fixed bottom-20 left-0 right-0 ${currentUiStyle} backdrop-blur-xl rounded-t-2xl p-5 z-[60] space-y-5 animate-in slide-in-from-bottom-5 border-t border-white/10 max-h-[70vh] overflow-y-auto`}
                    onClick={e => e.stopPropagation()}
                >
                    {/* View Mode */}
                    <div className="space-y-2">
                        <span className={`text-xs font-medium opacity-50 ml-1 ${currentTextStyle}`}>布局</span>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => { setViewMode('single'); localStorage.setItem('image_reader_viewMode', 'single'); }}
                                className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-all ${viewMode === 'single' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <Smartphone className="w-4 h-4" /> 单页
                            </button>
                            <button
                                onClick={() => { setViewMode('double'); localStorage.setItem('image_reader_viewMode', 'double'); }}
                                className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-all ${viewMode === 'double' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <BookOpen className="w-4 h-4" /> 双页
                            </button>
                        </div>
                    </div>

                    {/* Direction */}
                    <div className="space-y-2">
                        <span className={`text-xs font-medium opacity-50 ml-1 ${currentTextStyle}`}>翻页方向</span>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => { setDirection('ltr'); localStorage.setItem('image_reader_direction', 'ltr'); }}
                                className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-all ${direction === 'ltr' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <ArrowRight className="w-4 h-4" />
                                <div className="flex items-center gap-1">从左到右</div>
                            </button>
                            <button
                                onClick={() => { setDirection('rtl'); localStorage.setItem('image_reader_direction', 'rtl'); }}
                                className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-all ${direction === 'rtl' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <div className="flex items-center gap-1">从右到左</div>
                            </button>
                        </div>
                    </div>

                    {/* Render Engine (Fix for garbled text) */}
                    {bookFormat === 'pdf' && !isMobile && (
                        <div className="space-y-2">
                            <span className={`text-xs font-medium opacity-50 ml-1 ${currentTextStyle}`}>渲染引擎 (修复乱码)</span>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => { setRenderMode('canvas'); localStorage.setItem('image_reader_render_mode', 'canvas'); }}
                                    className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-all ${renderMode === 'canvas' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                                >
                                    <div className="flex items-center gap-1">内置渲染</div>
                                </button>
                                <button
                                    onClick={() => { setRenderMode('native'); localStorage.setItem('image_reader_render_mode', 'native'); }}
                                    className={`py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 border transition-all ${renderMode === 'native' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                                >
                                    <div className="flex items-center gap-1">原生/浏览器</div>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Fit / Zoom */}
                    <div className="space-y-2">
                        <span className={`text-xs font-medium opacity-50 ml-1 ${currentTextStyle}`}>缩放与适配</span>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                            <button
                                onClick={() => { setFitMode('width'); localStorage.setItem('image_reader_fitMode', 'width'); }}
                                className={`py-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 border transition-all ${fitMode === 'width' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <MoveHorizontal className="w-4 h-4" /> 适应宽度
                            </button>
                            <button
                                onClick={() => { setFitMode('height'); localStorage.setItem('image_reader_fitMode', 'height'); }}
                                className={`py-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 border transition-all ${fitMode === 'height' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <Minimize className="w-4 h-4" /> 适应高度
                            </button>
                            <button
                                onClick={() => { setFitMode('custom'); setScale(1.0); }}
                                className={`py-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 border transition-all ${fitMode === 'custom' ? 'bg-blue-600 border-blue-600 text-white' : `${itemBorder} ${itemBgHover} ${currentTextStyle}`}`}
                            >
                                <Maximize className="w-4 h-4" /> 原始大小
                            </button>
                        </div>

                        {/* Custom Zoom Controls */}
                        {fitMode === 'custom' && (
                            <div className={`flex items-center gap-3 rounded-lg p-2 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>
                                <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className={`p-2 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'} ${currentTextStyle}`}><ZoomOut className="w-4 h-4" /></button>
                                <span className={`flex-1 text-center text-xs font-mono font-medium ${currentTextStyle}`}>{(scale * 100).toFixed(0)}%</span>
                                <button onClick={() => setScale(s => Math.min(3.0, s + 0.1))} className={`p-2 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'} ${currentTextStyle}`}><ZoomIn className="w-4 h-4" /></button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* --- TOC Panel --- */}
            {showControls && activePanel === 'toc' && (
                <>
                    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]" onClick={() => setActivePanel(null)} />
                    <div className={`fixed inset-y-0 left-0 w-3/4 max-w-xs ${currentUiStyle} backdrop-blur-xl rounded-r-2xl shadow-2xl z-[70] flex flex-col animate-in slide-in-from-left-5`}>
                        <div className={`flex items-center justify-between border-b ${isDark ? 'border-white/10' : 'border-black/5'} p-4`}>
                            <h3 className={`font-bold ${currentTextStyle}`}>目录</h3>
                        </div>
                        <div className={`flex-1 overflow-y-auto p-2 custom-scrollbar ${isDark ? 'scrollbar-dark' : 'scrollbar-light'}`}>
                            {/* Virtual TOC for PDF / Comic */}
                            {Array.from({ length: numPages || 0 }).map((_, i) => {
                                const pageTitle = (stateRef.current.pages[i] && stateRef.current.pages[i].title) ? stateRef.current.pages[i].title : `第 ${i + 1} 页`;
                                const isCurrentPage = pageNumber === i + 1;
                                return (
                                    <button
                                        key={i}
                                        ref={isCurrentPage ? (el) => { if (el) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'auto' }), 100); } : null}
                                        onClick={() => { setPageNumber(i + 1); setActivePanel(null); }}
                                        className={`w-full text-left px-4 py-3 rounded-xl text-sm truncate transition-colors ${isCurrentPage
                                            ? (eInkMode ? 'bg-black text-white font-medium' : (isDark ? 'bg-blue-900/40 text-blue-300 font-medium' : 'bg-blue-50 text-blue-600 font-medium'))
                                            : (eInkMode ? 'text-black hover:bg-black/5' : (isDark ? 'text-gray-200 hover:bg-white/10' : 'text-gray-700 hover:bg-black/5'))
                                            }`}
                                    >
                                        {pageTitle}
                                    </button>
                                );
                            })}
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
            {/* --- Remove Confirmation Dialog --- */}
            {
                showRemoveDialog && (
                    <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-6 backdrop-blur-sm"
                        onClick={(e) => { e.stopPropagation(); setShowRemoveDialog(false); }}
                    >
                        <div
                            className={`${currentUiStyle} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className={`text-lg font-bold mb-2 ${currentTextStyle}`}>
                                移出书架
                            </h3>
                            <p className={`text-sm mb-6 ${currentTextStyle} opacity-70`}>
                                确定要从书架移除这本书吗？
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowRemoveDialog(false)}
                                    className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                                >
                                    取消
                                </button>
                                <button
                                    onClick={async () => {
                                        // 乐观更新：立即更新 UI
                                        setInBookshelf(false);
                                        setShowRemoveDialog(false);
                                        showToast.success('已移出书架');
                                        sessionStorage.removeItem('library_books_cache');
                                        window.dispatchEvent(new CustomEvent('library-refresh', { detail: { action: 'remove', bookIds: [bookId] } }));
                                        // 后台静默请求
                                        try {
                                            const res = await fetch(`/api/books/bookshelf/${bookId}`, {
                                                method: 'DELETE',
                                                credentials: 'include'
                                            });
                                            if (!res.ok) showToast.error('移出书架失败');
                                        } catch (e) { showToast.error('网络错误'); }
                                        setShowRemoveDialog(false);
                                    }}
                                    className={`flex-1 py-3 rounded-xl font-medium ${isDark ? 'bg-white text-black' : 'bg-gray-900 text-white'}`}
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default ImageReader;
