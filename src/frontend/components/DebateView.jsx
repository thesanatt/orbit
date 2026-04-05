import React from 'react';

export default function DebateView({ contradictions }) {
    if (!contradictions || contradictions.length === 0) return null;

    return (
        <div className="debate-view">
            <h3 className="panel-title">Tensions Found</h3>
            {contradictions.map((c, i) => (
                <div key={i} className="contradiction-card">
                    <div className="contradiction-sides">
                        <div className="claim claim-a">
                            <span className="claim-label">Claim A</span>
                            <p>{c.claim_a}</p>
                            <span className="claim-source">{c.source_a}</span>
                        </div>
                        <div className="vs-divider">
                            <span className="vs-icon">&harr;</span>
                        </div>
                        <div className="claim claim-b">
                            <span className="claim-label">Claim B</span>
                            <p>{c.claim_b}</p>
                            <span className="claim-source">{c.source_b}</span>
                        </div>
                    </div>
                    {c.tension && (
                        <div className="tension-description">
                            <p>{c.tension}</p>
                        </div>
                    )}
                    <button className="resolve-btn">Resolve</button>
                </div>
            ))}
        </div>
    );
}
