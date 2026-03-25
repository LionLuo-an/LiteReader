import React from 'react';

const FormatTag = ({ format, isDark, isEInk }) => {
    const fmt = (format || '').toLowerCase();

    // Base colors configuration
    const getColors = () => {
        if (isEInk) {
            return 'border border-black text-black bg-transparent';
        }

        switch (fmt) {
            case 'txt':
                return isDark
                    ? 'bg-blue-900/30 text-blue-300 border border-blue-800/30'
                    : 'bg-blue-50 text-blue-600 border border-blue-100';
            case 'epub':
                return isDark
                    ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-800/30'
                    : 'bg-emerald-50 text-emerald-600 border border-emerald-100';
            case 'pdf':
                return isDark
                    ? 'bg-red-900/30 text-red-300 border border-red-800/30'
                    : 'bg-red-50 text-red-600 border border-red-100';
            case 'mobi':
            case 'azw3':
                return isDark
                    ? 'bg-amber-900/30 text-amber-300 border border-amber-800/30'
                    : 'bg-amber-50 text-amber-600 border border-amber-100';
            case 'cbz':
            case 'cbr':
                return isDark
                    ? 'bg-purple-900/30 text-purple-300 border border-purple-800/30'
                    : 'bg-purple-50 text-purple-600 border border-purple-100';
            default:
                return isDark
                    ? 'bg-gray-800 text-gray-400 border border-gray-700'
                    : 'bg-gray-100 text-gray-500 border border-gray-200';
        }
    };

    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium font-mono uppercase tracking-wide shrink-0 ${getColors()}`}>
            {fmt}
        </span>
    );
};

export default FormatTag;
