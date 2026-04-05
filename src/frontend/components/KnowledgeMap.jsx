import React, { useMemo } from 'react';

const DOMAIN_COLORS = {
    machine_learning: '#00D4FF',
    startups: '#FF8844',
    cognitive_science: '#AA66FF',
    philosophy: '#44DDAA',
    cross_domain: '#FFD700',
    arts: '#FF6699',
    general: '#8899AA',
    default: '#8899AA'
};

export default function KnowledgeMap({ graphData, isDarkMode }) {
    // Derive territories from graph data
    const territories = useMemo(() => {
        if (!graphData || !graphData.nodes) return [];

        const concepts = graphData.nodes.filter(n => n.type === 'Concept');
        const domainMap = {};

        for (const node of concepts) {
            const domain = node.domain || 'general';
            if (!domainMap[domain]) {
                domainMap[domain] = { domain, concepts: [], edgeCount: 0 };
            }
            domainMap[domain].concepts.push(node);
        }

        // Count edges within each domain
        for (const link of (graphData.links || [])) {
            const sourceNode = graphData.nodes.find(n => n.id === (link.source?.id || link.source));
            const targetNode = graphData.nodes.find(n => n.id === (link.target?.id || link.target));
            if (sourceNode && targetNode && sourceNode.domain && targetNode.domain) {
                if (sourceNode.domain === targetNode.domain && domainMap[sourceNode.domain]) {
                    domainMap[sourceNode.domain].edgeCount++;
                }
            }
        }

        return Object.values(domainMap)
            .map(d => ({
                domain: d.domain,
                concept_count: d.concepts.length,
                density: d.concepts.length >= 10 ? 'dense' : d.concepts.length >= 5 ? 'moderate' : 'sparse',
                is_island: d.edgeCount === 0 && d.concepts.length <= 2,
                avg_importance: d.concepts.reduce((s, c) => s + (c.importance || 0.5), 0) / d.concepts.length,
                concepts: d.concepts.map(c => c.name),
            }))
            .sort((a, b) => b.concept_count - a.concept_count);
    }, [graphData]);

    if (territories.length === 0) {
        return (
            <div className="knowledge-map empty">
                <p>No concepts in the graph yet. Ingest some knowledge to see your territory map.</p>
            </div>
        );
    }

    const maxCount = Math.max(...territories.map(t => t.concept_count));

    return (
        <div className="knowledge-map">
            <h3 className="panel-title">Knowledge Territory</h3>
            <p className="map-subtitle">{territories.length} domains mapped</p>
            <div className="territory-grid">
                {territories.map((territory, i) => {
                    const size = Math.max(80, (territory.concept_count / maxCount) * 180);
                    const color = DOMAIN_COLORS[territory.domain] || DOMAIN_COLORS.default;

                    return (
                        <div
                            key={i}
                            className={`territory-bubble ${territory.density} ${territory.is_island ? 'island' : ''}`}
                            style={{
                                width: size,
                                height: size,
                                backgroundColor: isDarkMode ? `${color}15` : `${color}20`,
                                borderColor: color,
                                boxShadow: isDarkMode ? `0 0 ${size / 3}px ${color}33` : `0 2px 8px rgba(0,0,0,0.1)`,
                            }}
                        >
                            <span className="territory-label">
                                {territory.domain.replace(/_/g, ' ')}
                            </span>
                            <span className="territory-count">{territory.concept_count}</span>
                            <span className="territory-density">{territory.density}</span>
                            {territory.is_island && <span className="island-badge">Island</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
