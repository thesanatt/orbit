import React from 'react';

export default function ModeToggle({ isDark, onToggle }) {
    return (
        <button className="mode-toggle" onClick={onToggle} title={isDark ? 'Switch to Day Mode' : 'Switch to Night Mode'}>
            <div className={`toggle-track ${isDark ? 'night' : 'day'}`}>
                <div className="toggle-thumb">
                    {isDark ? '\u{1F319}' : '\u2600\uFE0F'}
                </div>
            </div>
        </button>
    );
}
