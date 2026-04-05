import React, { useState, useEffect, useRef } from 'react';

const WALKER_COLORS = {
    ingestor: '#44FF88',
    explorer: '#FFD700',
    pathfinder: '#00D4FF',
    consolidator: '#FFFFFF',
    cartographer: '#AA66FF'
};

export default function WalkerTrail({ trail, graphRef }) {
    // trail = { walkerType, nodeIds, currentStep, speed }
    const [activeStep, setActiveStep] = useState(0);
    const [trailSegments, setTrailSegments] = useState([]);

    useEffect(() => {
        if (!trail || !trail.nodeIds || trail.nodeIds.length === 0) return;

        setActiveStep(0);
        setTrailSegments([]);

        // Animate through trail steps
        const interval = setInterval(() => {
            setActiveStep(prev => {
                if (prev >= trail.nodeIds.length - 1) {
                    clearInterval(interval);
                    return prev;
                }
                // Add segment
                setTrailSegments(segs => [...segs, {
                    from: trail.nodeIds[prev],
                    to: trail.nodeIds[prev + 1],
                    timestamp: Date.now()
                }]);
                return prev + 1;
            });
        }, trail.speed || 800);

        return () => clearInterval(interval);
    }, [trail]);

    // Trail segments fade out after 5 seconds
    useEffect(() => {
        const cleanup = setInterval(() => {
            setTrailSegments(segs =>
                segs.filter(s => Date.now() - s.timestamp < 5000)
            );
        }, 1000);
        return () => clearInterval(cleanup);
    }, []);

    if (!trail) return null;

    const color = WALKER_COLORS[trail.walkerType] || '#00D4FF';

    return (
        <div className="walker-trail-overlay">
            <div className="walker-status">
                <span className="walker-dot" style={{ backgroundColor: color }} />
                <span className="walker-label">
                    {trail.walkerType} walking...
                </span>
                <span className="walker-step">
                    Step {activeStep + 1} / {trail.nodeIds.length}
                </span>
            </div>
        </div>
    );
}
