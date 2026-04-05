import React, { useState } from 'react';

const EXAMPLE_QUERIES = [
    "How is cramming like technical debt?",
    "What does exercise have to do with grades?",
    "Why is procrastination a bug, not laziness?",
    "How is imposter syndrome like overfitting?",
    "How is networking like an algorithm?",
];

export default function QueryBar({ onQuery, isLoading }) {
    const [question, setQuestion] = useState('');
    const [showExamples, setShowExamples] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!question.trim() || isLoading) return;
        setShowExamples(false);
        await onQuery(question);
    };

    const handleExampleClick = (q) => {
        setQuestion(q);
        setShowExamples(false);
        onQuery(q);
    };

    return (
        <div className="query-bar">
            <form className="query-bar-form" onSubmit={handleSubmit}>
                <span className="query-icon">{isLoading ? '\u21BB' : '\u26B2'}</span>
                <input
                    type="text"
                    className="query-input"
                    placeholder="Ask a question about your notes..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onFocus={() => !question && setShowExamples(true)}
                    onBlur={() => setTimeout(() => setShowExamples(false), 200)}
                    disabled={isLoading}
                />
                <button type="submit" className="query-submit" disabled={isLoading || !question.trim()}>
                    {isLoading ? 'Walking...' : 'Pathfind'}
                </button>
            </form>
            {showExamples && (
                <div className="query-examples">
                    <div className="query-examples-label">Try these:</div>
                    {EXAMPLE_QUERIES.map((q, i) => (
                        <button
                            key={i}
                            className="query-example-btn"
                            onMouseDown={() => handleExampleClick(q)}
                        >
                            {q}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
