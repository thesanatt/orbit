import React, { useState } from 'react';

const SOURCE_TYPES = [
    { value: 'article', label: 'Article' },
    { value: 'note', label: 'Note' },
    { value: 'tweet', label: 'Tweet' },
    { value: 'highlight', label: 'Highlight' },
    { value: 'thought', label: 'Thought' },
    { value: 'lecture', label: 'Lecture' }
];

export default function IngestPanel({ onIngest }) {
    const [text, setText] = useState('');
    const [sourceType, setSourceType] = useState('note');
    const [url, setUrl] = useState('');
    const [isIngesting, setIsIngesting] = useState(false);

    const handleIngest = async () => {
        if (!text.trim()) return;
        setIsIngesting(true);
        await onIngest(text, sourceType, url);
        setIsIngesting(false);
        setText('');
        setUrl('');
    };

    return (
        <div className="ingest-panel">
            <h3 className="panel-title">Add Knowledge</h3>

            <div className="source-type-selector">
                {SOURCE_TYPES.map(st => (
                    <button
                        key={st.value}
                        className={`source-type-btn ${sourceType === st.value ? 'active' : ''}`}
                        onClick={() => setSourceType(st.value)}
                    >
                        {st.label}
                    </button>
                ))}
            </div>

            <textarea
                className="ingest-textarea"
                placeholder="Paste something you learned today..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
            />

            <input
                type="text"
                className="ingest-url"
                placeholder="Source URL (optional)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
            />

            <button
                className="ingest-button"
                onClick={handleIngest}
                disabled={!text.trim() || isIngesting}
            >
                {isIngesting ? (
                    <><span className="ingest-spinner">&#x25CC;</span> Ingesting...</>
                ) : (
                    <><span>+</span> Ingest Knowledge</>
                )}
            </button>
        </div>
    );
}
