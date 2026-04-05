import React from 'react';

const NODE_TYPE_ICONS = {
    Concept: '\u25C9',
    Source: '\u{1F4C4}',
    Insight: '\u2726',
    Question: '?',
    Person: '\u{1F464}',
    Project: '\u{1F4C1}'
};

export default function NodeDetail({ node, onClose, graphData }) {
    if (!node) return null;

    // Find connected edges
    const connectedEdges = graphData.links.filter(
        l => (l.source.id || l.source) === node.id || (l.target.id || l.target) === node.id
    );

    // Find connected nodes
    const connectedNodes = connectedEdges.map(e => {
        const otherId = (e.source.id || e.source) === node.id
            ? (e.target.id || e.target)
            : (e.source.id || e.source);
        return graphData.nodes.find(n => n.id === otherId);
    }).filter(Boolean);

    return (
        <div className="node-detail">
            <div className="node-detail-header">
                <span className="node-type-icon">{NODE_TYPE_ICONS[node.type] || '\u25CB'}</span>
                <div>
                    <h3 className="node-name">{node.name || node.title || node.text}</h3>
                    <span className="node-type-badge">{node.type}</span>
                    {node.domain && <span className="node-domain-badge">{node.domain}</span>}
                </div>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            <div className="node-detail-body">
                {node.description && (
                    <div className="detail-section">
                        <h4>Description</h4>
                        <p>{node.description}</p>
                    </div>
                )}

                {node.content && (
                    <div className="detail-section">
                        <h4>Content</h4>
                        <p className="content-text">{node.content}</p>
                    </div>
                )}

                <div className="detail-section">
                    <h4>Stats</h4>
                    <div className="stats-grid">
                        {node.importance !== undefined && (
                            <div className="stat-item">
                                <span className="stat-label">Importance</span>
                                <div className="stat-bar">
                                    <div className="stat-bar-fill" style={{ width: `${node.importance * 100}%` }} />
                                </div>
                            </div>
                        )}
                        {node.access_count !== undefined && (
                            <div className="stat-item">
                                <span className="stat-label">Visits</span>
                                <span className="stat-value">{node.access_count}</span>
                            </div>
                        )}
                        {node.depth && (
                            <div className="stat-item">
                                <span className="stat-label">Depth</span>
                                <span className={`depth-badge ${node.depth}`}>{node.depth}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="detail-section">
                    <h4>Connections ({connectedNodes.length})</h4>
                    <div className="connection-list">
                        {connectedEdges.map((edge, i) => {
                            const otherNode = connectedNodes[i];
                            if (!otherNode) return null;
                            return (
                                <div key={i} className="connection-item">
                                    <span className="connection-type">{edge.type}</span>
                                    <span className="connection-name">{otherNode.name || otherNode.title}</span>
                                    {edge.strength && (
                                        <span className="connection-strength">
                                            {Math.round(edge.strength * 100)}%
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
