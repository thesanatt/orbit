import React, { useMemo } from 'react';

export default function InsightFeed({ insights, answer, onViewPath, graphData }) {
    const nodeNameMap = useMemo(() => {
        const map = {};
        if (graphData && graphData.nodes) {
            for (const n of graphData.nodes) {
                map[n.id] = n.name || n.title || n.text || n.id;
            }
        }
        return map;
    }, [graphData]);

    const resolvePathNames = (path) => {
        if (!path || path.length === 0) return [];
        return path.map(id => nodeNameMap[id] || id);
    };

    const displayInsights = useMemo(() => {
        if (insights && insights.length > 0) return insights;
        if (graphData && graphData.nodes) {
            return graphData.nodes
                .filter(n => n.type === 'Insight')
                .map(n => ({
                    id: n.id,
                    title: n.name || n.title,
                    description: n.description,
                    confidence: n.confidence || 0.8,
                    path: n.path || [],
                    generatedAt: n.generated_at || n.generatedAt || Date.now() / 1000,
                    validated: n.validated || false,
                }));
        }
        return [];
    }, [insights, graphData]);

    const knowledgeStats = useMemo(() => {
        const concepts = (graphData?.nodes || []).filter(n => n.type === 'Concept');
        const links = graphData?.links || [];

        const domains = {};
        concepts.forEach(n => { domains[n.domain] = (domains[n.domain] || 0) + 1; });

        const edgeCounts = {};
        links.forEach(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            edgeCounts[s] = (edgeCounts[s] || 0) + 1;
            edgeCounts[t] = (edgeCounts[t] || 0) + 1;
        });
        const mostConnected = Object.entries(edgeCounts).sort((a, b) => b[1] - a[1])[0];
        const mostConnectedName = (graphData?.nodes || []).find(n => n.id === mostConnected?.[0])?.name;

        const strongLinks = links.filter(l => (l.strength || 0.5) > 0.5).length;
        const healthPct = links.length > 0 ? Math.round(strongLinks / links.length * 100) : 0;

        return {
            concepts: concepts.length,
            domains: Object.keys(domains).length,
            mostConnected: mostConnectedName || 'none',
            healthPct,
        };
    }, [graphData]);

    return (
        <div className="insight-feed">
            {/* Knowledge Stats */}
            {graphData && graphData.nodes && graphData.nodes.length > 0 && (
                <div className="knowledge-stats-section">
                    <div className="feed-section-label">
                        <span className="feed-section-icon" style={{ color: '#00D4FF' }}>&#x2637;</span>
                        Knowledge Stats
                    </div>
                    <div className="knowledge-stats-grid">
                        <div className="kstat">
                            <span className="kstat-value">{knowledgeStats.concepts}</span>
                            <span className="kstat-label">concepts</span>
                        </div>
                        <div className="kstat">
                            <span className="kstat-value">{knowledgeStats.domains}</span>
                            <span className="kstat-label">domains</span>
                        </div>
                        <div className="kstat">
                            <span className="kstat-value">{knowledgeStats.mostConnected}</span>
                            <span className="kstat-label">most connected</span>
                        </div>
                        <div className="kstat">
                            <span className="kstat-value">{knowledgeStats.healthPct}%</span>
                            <span className="kstat-label">connections strong</span>
                        </div>
                    </div>
                    <div className="health-bar-container">
                        <div className="health-bar-track">
                            <div className="health-bar-fill" style={{ width: `${knowledgeStats.healthPct}%` }} />
                        </div>
                        <span className="health-bar-label">
                            {knowledgeStats.healthPct}% of connections above 0.5 strength
                        </span>
                    </div>
                </div>
            )}

            {/* Pathfinder Answer */}
            {answer && (
                <div className="answer-section">
                    <div className="feed-section-label">
                        <span className="feed-section-icon feed-section-icon--answer">&#x26A1;</span>
                        Pathfinder
                    </div>
                    <div className="answer-card-premium">
                        <div className="answer-question-row">
                            <span className="answer-q-mark">Q</span>
                            <p className="answer-question-text">{answer.question}</p>
                        </div>
                        {answer.loading ? (
                            <div className="answer-loading-premium">
                                <div className="answer-loading-dots">
                                    <span className="loading-dot loading-dot--1" />
                                    <span className="loading-dot loading-dot--2" />
                                    <span className="loading-dot loading-dot--3" />
                                </div>
                                <span className="answer-loading-text">Pathfinder traversing your knowledge graph...</span>
                            </div>
                        ) : (
                            <>
                                <p className="answer-text-premium">{answer.text}</p>
                                {answer.path && answer.path.length > 0 && (
                                    <div className="answer-path-premium">
                                        <span className="path-label-subtle">Traversal path</span>
                                        <div className="path-pills">
                                            {answer.path.map((node, i) => (
                                                <React.Fragment key={i}>
                                                    <span className="path-pill path-pill--answer">{node}</span>
                                                    {i < answer.path.length - 1 && (
                                                        <span className="path-connector">
                                                            <svg width="16" height="8" viewBox="0 0 16 8">
                                                                <path d="M0 4 L12 4 M9 1 L12 4 L9 7" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.4"/>
                                                            </svg>
                                                        </span>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Discoveries */}
            <div className="feed-section-label">
                <span className="feed-section-icon feed-section-icon--discovery">&#x2726;</span>
                Discoveries
                {displayInsights.length > 0 && (
                    <span className="feed-count-badge">{displayInsights.length}</span>
                )}
            </div>

            {/* Fading Connections */}
            {graphData && graphData.links && graphData.links.length > 0 && (
                <>
                    <div className="feed-section-label" style={{ marginTop: 16 }}>
                        <span className="feed-section-icon" style={{ color: '#FF6B6B' }}>&#x23F3;</span>
                        Fading Connections
                    </div>
                    <div className="fading-list">
                        {graphData.links
                            .filter(l => (l.strength || 0.5) < 0.35 && l.type === 'relates_to')
                            .slice(0, 3)
                            .map((link, i) => {
                                const sourceName = nodeNameMap[typeof link.source === 'object' ? link.source.id : link.source] || '?';
                                const targetName = nodeNameMap[typeof link.target === 'object' ? link.target.id : link.target] || '?';
                                const pct = Math.round((link.strength || 0.3) * 100);
                                return (
                                    <div key={i} className="fading-card">
                                        <div className="fading-connection">
                                            <span className="fading-node">{sourceName}</span>
                                            <span className="fading-arrow" style={{ opacity: link.strength || 0.3 }}>&#x2194;</span>
                                            <span className="fading-node">{targetName}</span>
                                        </div>
                                        <div className="fading-bar-track">
                                            <div className="fading-bar-fill" style={{ width: `${pct}%`, background: pct < 20 ? '#FF4466' : '#FF8844' }} />
                                        </div>
                                        <span className="fading-label">
                                            {pct < 20 ? 'Almost forgotten' : 'Fading'} - {pct}% strength
                                        </span>
                                    </div>
                                );
                            })}
                        {graphData.links.filter(l => (l.strength || 0.5) < 0.35 && l.type === 'relates_to').length === 0 && (
                            <p className="fading-empty">All your connections are strong!</p>
                        )}
                    </div>
                </>
            )}

            {displayInsights.length === 0 ? (
                <div className="no-insights-premium">
                    <div className="no-insights-icon">&#x1F50D;</div>
                    <p className="no-insights-title">No discoveries yet</p>
                    <p className="no-insights-hint">
                        Ask a question or hit Surprise Me &mdash; answers get saved here as discoveries.
                    </p>
                </div>
            ) : (
                <div className="insight-list-premium">
                    {displayInsights.map((insight, i) => {
                        const pathNames = resolvePathNames(insight.path);
                        const confidencePct = Math.round((insight.confidence || 0.8) * 100);

                        return (
                            <div
                                key={insight.id || i}
                                className="insight-card-premium"
                                style={{ animationDelay: `${i * 0.06}s` }}
                            >
                                <div className="insight-card-accent" />
                                <div className="insight-card-body">
                                    <div className="insight-card-header">
                                        <h4 className="insight-card-title">{insight.title}</h4>
                                        <span className="insight-confidence-badge" title={`${confidencePct}% confidence`}>
                                            {confidencePct}%
                                        </span>
                                    </div>

                                    {pathNames.length > 0 && (
                                        <div className="insight-card-path">
                                            <span className="path-label-subtle">Discovery path</span>
                                            <div className="path-pills">
                                                {pathNames.map((name, j) => (
                                                    <React.Fragment key={j}>
                                                        <span className="path-pill path-pill--insight">{name}</span>
                                                        {j < pathNames.length - 1 && (
                                                            <span className="path-connector path-connector--gold">
                                                                <svg width="14" height="8" viewBox="0 0 14 8">
                                                                    <path d="M0 4 L10 4 M7 1 L10 4 L7 7" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.5"/>
                                                                </svg>
                                                            </span>
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="insight-card-actions">
                                        <button
                                            className="view-path-btn-premium"
                                            onClick={() => onViewPath && onViewPath(insight.path)}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 5 }}>
                                                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                                                <circle cx="7" cy="7" r="2" fill="currentColor"/>
                                            </svg>
                                            View on Graph
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
