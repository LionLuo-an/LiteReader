import React, { useState, useRef, useEffect } from 'react';
import { X, Upload, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { showToast } from './Toast';

const CoverEditorDialog = ({ isOpen, onClose, book, onSuccess, isDark, coverColors }) => {
    const [loading, setLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(book?.cover || null);
    const [resetToDefault, setResetToDefault] = useState(false);
    const fileInputRef = useRef(null);

    // Reset state when book changes or dialog opens
    useEffect(() => {
        if (isOpen && book) {
            setPreviewUrl(book.cover || null);
            setSelectedFile(null);
            setResetToDefault(false);
        }
    }, [isOpen, book]);

    // Handle File Selection
    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setSelectedFile(file);
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            setResetToDefault(false);
        }
    };

    // Handle Reset to Default (Remove Cover)
    const handleReset = async () => {
        if (!book) return;
        setSelectedFile(null);
        setResetToDefault(true);
        setLoading(true);
        try {
            const res = await fetch(`/api/books/${book.id}/cover/default`, {
                credentials: 'include'
            });
            if (res.ok) {
                let coverPath = null;
                try {
                    const data = await res.json();
                    coverPath = data?.cover ?? null;
                } catch (e) {}
                setPreviewUrl(coverPath ? `${coverPath}?t=${Date.now()}` : null);
            } else {
                let message = '获取默认封面失败';
                try {
                    const data = await res.json();
                    if (data?.error) message = data.error;
                } catch (e) {}
                setPreviewUrl(null);
                showToast.error(message);
            }
        } catch (e) {
            console.error(e);
            setPreviewUrl(null);
            showToast.error('获取默认封面失败');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!book) return;
        
        // Scenario 1: Reset to default (no file)
        if (!selectedFile && (resetToDefault || !previewUrl)) {
            // Only need to delete if there was a cover previously
            if (!book.cover) {
                onClose();
                return;
            }

            setLoading(true);
            try {
                const res = await fetch(`/api/books/${book.id}/cover`, {
                    method: 'DELETE',
                    credentials: 'include'
                });

                if (res.ok) {
                    let restoredCover = null;
                    try {
                        const data = await res.json();
                        restoredCover = data?.cover ?? null;
                    } catch (e) {}
                    onSuccess(book.id, restoredCover);
                    onClose();
                    showToast.success('已恢复默认封面');
                } else {
                    let message = '恢复默认失败';
                    try {
                        const data = await res.json();
                        if (data?.error) message = data.error;
                    } catch (e) {}
                    showToast.error(message);
                }
            } catch (e) {
                console.error(e);
                showToast.error('恢复默认失败');
            } finally {
                setLoading(false);
            }
            return;
        }

        // Scenario 2: No changes (using existing cover)
        if (!selectedFile && previewUrl === book.cover) {
            onClose();
            return;
        }

        // Scenario 3: Upload new cover
        if (selectedFile) {
            setLoading(true);
            try {
                let formData = new FormData();
                formData.append('cover', selectedFile);

                const res = await fetch(`/api/books/${book.id}/cover`, {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });

                if (res.ok) {
                    const data = await res.json();
                    onSuccess(book.id, data.cover);
                    onClose();
                    showToast.success('封面更新成功');
                } else {
                    let message = '封面更新失败';
                    try {
                        const data = await res.json();
                        if (data?.error) message = data.error;
                    } catch (e) {}
                    showToast.error(message);
                }
            } catch (e) {
                console.error(e);
                showToast.error('封面更新失败');
            } finally {
                setLoading(false);
            }
        }
    };

    if (!isOpen) return null;

    const colors = {
        bg: isDark ? 'bg-[#1C1C1E]' : 'bg-white',
        text: isDark ? 'text-gray-200' : 'text-gray-800',
        border: isDark ? 'border-gray-700' : 'border-gray-200',
        inputBg: isDark ? 'bg-[#2C2C2E]' : 'bg-gray-50',
    };

    // Default Text Cover Preview Component
    const DefaultCoverPreview = () => {
        // Use coverColors passed from parent or fallback
        const previewColors = coverColors || {
            bg: '#fdf6e3',
            border: '#8c7b64',
            dashed: '#d6c6ac',
            text: 'text-gray-800'
        };

        return (
            <div className="w-full h-full flex flex-col p-3 border-l-4 rounded-r-lg shadow-sm"
                style={{
                    backgroundColor: previewColors.bg,
                    borderColor: previewColors.border
                }}
            >
                <div className="flex-1 border-b border-dashed mb-2 flex items-center justify-center" style={{ borderColor: previewColors.dashed }}>
                    <h3 className={`font-serif font-bold text-xs leading-relaxed line-clamp-3 text-center break-all ${previewColors.text}`} style={{ color: previewColors.text.startsWith('text-') ? undefined : '#333' }}>
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
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className={`${colors.bg} w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}>
                {/* Header */}
                <div className={`px-6 py-4 border-b ${colors.border} flex items-center justify-between`}>
                    <h3 className={`font-bold text-lg ${colors.text}`}>更改封面</h3>
                    <button onClick={onClose} className={`p-2 rounded-full hover:bg-black/5 ${isDark ? 'hover:bg-white/10' : ''}`}>
                        <X className={`w-5 h-5 ${colors.text}`} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center gap-6">
                    <div 
                        className="relative group w-[180px] h-[270px] shadow-lg rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center cursor-pointer border-2 border-transparent hover:border-blue-500 transition-all"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {previewUrl ? (
                            <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                            // Show Default Text Cover Preview when no image
                            <DefaultCoverPreview />
                        )}
                        
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="bg-white/90 p-3 rounded-full shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                                <Upload className="w-6 h-6 text-blue-600" />
                            </div>
                        </div>
                    </div>
                    
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                    
                    <div className="text-center">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className={`px-6 py-2 rounded-full border text-sm font-medium mb-2 ${colors.border} ${colors.text} hover:bg-black/5 transition-colors`}
                        >
                            选择图片
                        </button>
                        <p className="text-xs text-gray-500">
                            支持 JPG, PNG, WEBP 格式<br/>建议比例 2:3
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className={`p-4 border-t ${colors.border} flex items-center justify-between gap-3`}>
                    <button 
                        onClick={handleReset}
                        className={`flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium text-orange-500 hover:bg-orange-50 transition-colors ${isDark ? 'hover:bg-orange-900/20' : ''}`}
                        title="恢复默认封面样式"
                    >
                        <RotateCcw className="w-4 h-4" />
                        <span>恢复默认</span>
                    </button>

                    <div className="flex gap-3 flex-1 justify-end">
                        <button
                            onClick={onClose}
                            className={`px-6 py-3 rounded-xl font-medium ${isDark ? 'bg-[#2C2C2E] text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="px-6 py-3 rounded-xl font-medium bg-blue-600 text-white shadow-lg shadow-blue-500/30 disabled:opacity-70 flex items-center justify-center gap-2 min-w-[100px]"
                        >
                            {loading ? '保存中...' : '确认更改'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CoverEditorDialog;
