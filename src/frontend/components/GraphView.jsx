import React, { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

// ─── Color Palette ───────────────────────────────────────────────────────────

const NODE_COLORS = {
    Concept:  '#00D4FF',
    Source:   '#8899AA',
    Insight:  '#FFD700',
    Question: '#AA66FF',
    Person:   '#44DDAA',
    Project:  '#FF8844',
};

const NODE_COLORS_DAY = {
    Concept:  '#0099CC',
    Source:   '#667788',
    Insight:  '#CC9900',
    Question: '#7744CC',
    Person:   '#22AA77',
    Project:  '#CC6622',
};

const EDGE_COLORS = {
    relates_to:   'rgba(255, 255, 255, 0.28)',
    builds_upon:  'rgba(0, 212, 255, 0.55)',
    contradicts:  'rgba(255, 68, 102, 0.65)',
    sourced_from: 'rgba(136, 153, 170, 0.20)',
    inspired_by:  'rgba(255, 215, 0, 0.40)',
    applied_in:   'rgba(255, 136, 68, 0.25)',
    mentioned_by: 'rgba(68, 221, 170, 0.22)',
    temporal:     'rgba(100, 100, 180, 0.10)',
};

const EDGE_COLORS_DAY = {
    relates_to:   'rgba(80, 80, 100, 0.18)',
    builds_upon:  'rgba(0, 140, 200, 0.45)',
    contradicts:  'rgba(200, 40, 60, 0.50)',
    sourced_from: 'rgba(100, 110, 130, 0.15)',
    inspired_by:  'rgba(180, 140, 0, 0.40)',
    applied_in:   'rgba(200, 100, 40, 0.30)',
    mentioned_by: 'rgba(30, 160, 120, 0.30)',
    temporal:     'rgba(80, 80, 140, 0.12)',
};

const WALKER_COLORS = {
    ingestor:     '#44DDAA',
    explorer:     '#FFD700',
    pathfinder:   '#00D4FF',
    consolidator: '#FFFFFF',
    cartographer: '#AA66FF',
};

const BG_DARK  = '#08080F';
const BG_LIGHT = '#F8F6F0';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert hex color to rgba string. */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Parse hex to {r, g, b} */
function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GraphView({
    data,
    onNodeClick,
    selectedNode,
    walkerTrail,
    walkerType,
    isDarkMode = true,
    zoomToFitTrigger = 0,
}) {
    const graphRef = useRef();
    const [hoverNode, setHoverNode] = useState(null);
    const animPhase = useRef(0);

    // Build a Set for O(1) trail lookups
    const trailSet = useMemo(() => {
        if (!walkerTrail || walkerTrail.length === 0) return null;
        return new Set(walkerTrail);
    }, [walkerTrail]);

    // Build a Set of trail edge pairs for highlighting walker path edges
    const trailEdgeSet = useMemo(() => {
        if (!walkerTrail || walkerTrail.length < 2) return null;
        const set = new Set();
        for (let i = 0; i < walkerTrail.length - 1; i++) {
            set.add(`${walkerTrail[i]}__${walkerTrail[i + 1]}`);
            set.add(`${walkerTrail[i + 1]}__${walkerTrail[i]}`);
        }
        return set;
    }, [walkerTrail]);

    const walkerColor = WALKER_COLORS[walkerType] || WALKER_COLORS.pathfinder;

    // Continuously tick animation phase for breathing effect
    useEffect(() => {
        let raf;
        const tick = () => {
            animPhase.current = (Date.now() % 8000) / 8000;
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    // Keep canvas repainting while walker trail is active (for pulse animation)
    // Call the force-graph refresh() directly — does NOT re-render React tree,
    // so prop refs stay stable and drag/simulation are not disturbed.
    useEffect(() => {
        if (!trailSet) return;
        const interval = setInterval(() => {
            const fg = graphRef.current;
            if (fg && typeof fg.refresh === 'function') fg.refresh();
        }, 50);
        return () => clearInterval(interval);
    }, [trailSet]);

    // ── Node painter ────────────────────────────────────────────────────────

    const paintNode = useCallback((node, ctx, globalScale) => {
        // Guard: skip if position not yet computed by force simulation
        if (!isFinite(node.x) || !isFinite(node.y)) return;

        const importance = node.importance ?? 0.5;
        const isInsight = node.type === 'Insight';
        const isSource = node.type === 'Source';

        const baseSize = isSource ? 2 : (isInsight ? 3.5 : 2.8);
        const size = baseSize + importance * (isSource ? 2.5 : (isInsight ? 6 : 5));

        const isSelected = selectedNode && selectedNode.id === node.id;
        const isHovered = hoverNode && hoverNode.id === node.id;
        const isOnTrail = trailSet && trailSet.has(node.id);
        const colors = isDarkMode ? NODE_COLORS : NODE_COLORS_DAY;
        const color = colors[node.type] || '#888888';
        const rgb = hexToRgb(color.startsWith('#') ? color : '#888888');

        // Breathing animation offset per node (deterministic from ID hash)
        const idHash = (node.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const breathPhase = ((Date.now() + idHash * 137) % 6000) / 6000;
        const breathScale = 1 + Math.sin(breathPhase * Math.PI * 2) * 0.03;
        const effectiveSize = size * breathScale;

        // ── Night-mode layered glow halos (deep space orb) ─────────────
        if (isDarkMode) {
            // Outermost diffuse glow (huge, very soft)
            const farRadius = effectiveSize * (isInsight ? 9 : (isOnTrail ? 7 : 5.5));
            ctx.beginPath();
            ctx.arc(node.x, node.y, farRadius, 0, 2 * Math.PI);
            const farGrad = ctx.createRadialGradient(
                node.x, node.y, effectiveSize * 0.5,
                node.x, node.y, farRadius
            );
            farGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isInsight ? 0.12 : (isOnTrail ? 0.14 : 0.07)})`);
            farGrad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isInsight ? 0.04 : 0.02})`);
            farGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = farGrad;
            ctx.fill();

            // Outer halo (medium-large, richer)
            const outerRadius = effectiveSize * (isInsight ? 6 : (isOnTrail ? 5 : 4));
            const outerAlpha = isInsight ? 0.28 : (isOnTrail ? 0.30 : 0.16);
            ctx.beginPath();
            ctx.arc(node.x, node.y, outerRadius, 0, 2 * Math.PI);
            const outerGrad = ctx.createRadialGradient(
                node.x, node.y, effectiveSize * 0.3,
                node.x, node.y, outerRadius
            );
            outerGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${outerAlpha})`);
            outerGrad.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${outerAlpha * 0.5})`);
            outerGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = outerGrad;
            ctx.fill();

            // Inner halo (tight, bright)
            const innerRadius = effectiveSize * (isInsight ? 3 : 2.3);
            const innerAlpha = isInsight ? 0.50 : (isOnTrail ? 0.42 : 0.28);
            ctx.beginPath();
            ctx.arc(node.x, node.y, innerRadius, 0, 2 * Math.PI);
            const innerGrad = ctx.createRadialGradient(
                node.x, node.y, effectiveSize * 0.2,
                node.x, node.y, innerRadius
            );
            innerGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${innerAlpha})`);
            innerGrad.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${innerAlpha * 0.4})`);
            innerGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = innerGrad;
            ctx.fill();

            // Insight nodes get an extra pulsing golden corona
            if (isInsight) {
                const coronaPulse = 1 + Math.sin(breathPhase * Math.PI * 2) * 0.15;
                const coronaRadius = effectiveSize * 4.5 * coronaPulse;
                ctx.beginPath();
                ctx.arc(node.x, node.y, coronaRadius, 0, 2 * Math.PI);
                const coronaGrad = ctx.createRadialGradient(
                    node.x, node.y, effectiveSize,
                    node.x, node.y, coronaRadius
                );
                coronaGrad.addColorStop(0, 'rgba(255, 215, 0, 0.12)');
                coronaGrad.addColorStop(0.5, 'rgba(255, 200, 0, 0.04)');
                coronaGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = coronaGrad;
                ctx.fill();
            }
        }

        // ── Walker trail ring (pulsing, glowing) ───────────────────────
        if (isOnTrail) {
            const trailPulse = 0.5 + Math.sin(Date.now() * 0.005) * 0.5;

            // Outer glow ring (pulses size and opacity)
            const outerRing = effectiveSize * (2.5 + trailPulse * 0.8);
            ctx.beginPath();
            ctx.arc(node.x, node.y, outerRing, 0, 2 * Math.PI);
            ctx.strokeStyle = hexToRgba(walkerColor, 0.15 + trailPulse * 0.25);
            ctx.lineWidth = Math.max(3, (4 + trailPulse * 2) / globalScale);
            ctx.stroke();

            // Inner bright ring
            const innerRing = effectiveSize * 2.2;
            ctx.beginPath();
            ctx.arc(node.x, node.y, innerRing, 0, 2 * Math.PI);
            ctx.strokeStyle = hexToRgba(walkerColor, 0.5 + trailPulse * 0.4);
            ctx.lineWidth = Math.max(2, 3.5 / globalScale);
            ctx.stroke();

            // Pulsing fill
            ctx.beginPath();
            ctx.arc(node.x, node.y, innerRing, 0, 2 * Math.PI);
            ctx.fillStyle = hexToRgba(walkerColor, 0.06);
            ctx.fill();
        }

        // ── Main circle ────────────────────────────────────────────────
        ctx.beginPath();
        ctx.arc(node.x, node.y, effectiveSize, 0, 2 * Math.PI);

        if (isDarkMode) {
            // Source nodes are more transparent
            const nodeAlpha = isSource ? 0.55 : 1.0;
            // Radial gradient fill gives the orb a shiny 3D look
            const bodyGrad = ctx.createRadialGradient(
                node.x - effectiveSize * 0.25, node.y - effectiveSize * 0.25, 0,
                node.x, node.y, effectiveSize
            );
            bodyGrad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 80)}, ${Math.min(255, rgb.g + 80)}, ${Math.min(255, rgb.b + 80)}, ${nodeAlpha})`);
            bodyGrad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${nodeAlpha})`);
            bodyGrad.addColorStop(1, `rgba(${Math.max(0, rgb.r - 40)}, ${Math.max(0, rgb.g - 40)}, ${Math.max(0, rgb.b - 40)}, ${nodeAlpha})`);
            ctx.fillStyle = bodyGrad;
            ctx.shadowColor = color;
            ctx.shadowBlur = isOnTrail ? 32 : (isInsight ? 26 : 16);
        } else {
            ctx.fillStyle = isSource ? hexToRgba(color, 0.55) : color;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
        }
        ctx.fill();

        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Bright specular highlight for dark mode (glossy orb sheen)
        if (isDarkMode && !isSource) {
            // Big soft highlight
            const hx = node.x - effectiveSize * 0.25;
            const hy = node.y - effectiveSize * 0.28;
            const hr = effectiveSize * 0.45;
            const hlGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
            hlGrad.addColorStop(0, isInsight ? 'rgba(255, 255, 235, 0.80)' : 'rgba(255, 255, 255, 0.65)');
            hlGrad.addColorStop(0.6, isInsight ? 'rgba(255, 250, 200, 0.25)' : 'rgba(255, 255, 255, 0.18)');
            hlGrad.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(hx, hy, hr, 0, 2 * Math.PI);
            ctx.fillStyle = hlGrad;
            ctx.fill();
            // Tiny bright pinpoint
            ctx.beginPath();
            ctx.arc(hx - effectiveSize * 0.05, hy - effectiveSize * 0.05, effectiveSize * 0.12, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fill();
        }

        // ── New node flash effect ────────────────────────────────────────
        if (node.isNew) {
            const flashPhase = ((Date.now()) % 800) / 800;
            const flashAlpha = 0.3 + Math.sin(flashPhase * Math.PI * 2) * 0.3;
            const flashRadius = effectiveSize * 4;
            ctx.beginPath();
            ctx.arc(node.x, node.y, flashRadius, 0, 2 * Math.PI);
            const flashGrad = ctx.createRadialGradient(
                node.x, node.y, effectiveSize,
                node.x, node.y, flashRadius
            );
            flashGrad.addColorStop(0, `rgba(68, 255, 136, ${flashAlpha})`);
            flashGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = flashGrad;
            ctx.fill();
        }

        // ── Selection ring ──────────────────────────────────────────────
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, effectiveSize + 4 / globalScale, 0, 2 * Math.PI);
            ctx.strokeStyle = isDarkMode ? '#FFFFFF' : '#333333';
            ctx.lineWidth = Math.max(1.5, 2.5 / globalScale);
            ctx.stroke();
        }

        // ── Hover expansion ─────────────────────────────────────────────
        if (isHovered && !isSelected) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, effectiveSize + 3 / globalScale, 0, 2 * Math.PI);
            ctx.strokeStyle = isDarkMode
                ? 'rgba(255, 255, 255, 0.6)'
                : 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = Math.max(1, 1.5 / globalScale);
            ctx.stroke();
        }

        // ── Label ───────────────────────────────────────────────────────
        // Always show labels
        const showLabel = true;
        if (showLabel) {
            const label = node.name || node.title || node.text || '';
            if (label) {
                // Scale font: bigger when zoomed in, readable when zoomed out
                const fontSize = Math.max(4, Math.min(7, 5 / globalScale));
                ctx.font = `500 ${fontSize}px "Inter", "SF Pro Display", -apple-system, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';

                const textWidth = ctx.measureText(label).width;
                const padding = 3 / globalScale;
                const textY = node.y + effectiveSize + 5 / globalScale;

                // Label background pill
                const pillHeight = fontSize + padding * 2;
                const pillWidth = textWidth + padding * 4;
                const pillRadius = pillHeight / 2;
                ctx.beginPath();
                ctx.roundRect(
                    node.x - pillWidth / 2,
                    textY - padding,
                    pillWidth,
                    pillHeight,
                    pillRadius
                );
                ctx.fillStyle = isDarkMode
                    ? 'rgba(8, 8, 20, 0.82)'
                    : 'rgba(248, 246, 240, 0.85)';
                ctx.fill();

                ctx.fillStyle = isDarkMode
                    ? 'rgba(255, 255, 255, 0.92)'
                    : 'rgba(30, 30, 40, 0.85)';
                ctx.fillText(label, node.x, textY);
            }
        }
    }, [selectedNode, hoverNode, trailSet, isDarkMode, walkerColor]);

    // ── Link painter ────────────────────────────────────────────────────────

    const paintLink = useCallback((link, ctx) => {
        const source = link.source;
        const target = link.target;
        // react-force-graph mutates source/target from string IDs to node object refs
        // during simulation. If still strings or positions not yet computed, skip frame.
        if (!source || !target) return;
        if (typeof source !== 'object' || typeof target !== 'object') return;
        if (!isFinite(source.x) || !isFinite(target.x) || !isFinite(source.y) || !isFinite(target.y)) return;

        const edgeColors = isDarkMode ? EDGE_COLORS : EDGE_COLORS_DAY;
        const baseColor = edgeColors[link.type] || edgeColors.relates_to;
        const strength = link.strength ?? 0.5;

        // Make relates_to edges thinner; important types thicker
        const isImportantType = ['builds_upon', 'contradicts', 'inspired_by'].includes(link.type);
        const width = isImportantType
            ? Math.max(1.2, strength * 3.5)
            : Math.max(0.8, strength * 2.4);

        // Check if this edge is on the walker trail
        const sourceId = typeof source === 'object' ? source.id : source;
        const targetId = typeof target === 'object' ? target.id : target;
        const isTrailEdge = trailEdgeSet &&
            trailEdgeSet.has(`${sourceId}__${targetId}`);

        // Dashed line for contradictions
        if (link.type === 'contradicts') {
            ctx.setLineDash([5, 5]);
        } else {
            ctx.setLineDash([]);
        }

        if (isTrailEdge) {
            // Pulsing blink effect - cycles between bright and dim
            const pulse = 0.5 + Math.sin(Date.now() * 0.005) * 0.5; // 0 to 1

            // Wide outer neon glow (pulses)
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = hexToRgba(walkerColor, 0.06 + pulse * 0.15);
            ctx.lineWidth = width + 16 + pulse * 6;
            ctx.stroke();

            // Mid glow
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = hexToRgba(walkerColor, 0.2 + pulse * 0.3);
            ctx.lineWidth = width + 6 + pulse * 4;
            ctx.stroke();

            // Bright core (always visible, pulses brighter)
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = hexToRgba(walkerColor, 0.7 + pulse * 0.3);
            ctx.lineWidth = width + 2 + pulse * 2;
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = baseColor;
            ctx.lineWidth = width;
            ctx.stroke();
        }

        ctx.setLineDash([]);

        // ── Directional arrow for builds_upon ───────────────────────────
        if (link.type === 'builds_upon') {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 1) return;

            const ux = dx / len;
            const uy = dy / len;

            const arrowPos = 0.7;
            const ax = source.x + dx * arrowPos;
            const ay = source.y + dy * arrowPos;
            const arrowSize = 4;

            ctx.beginPath();
            ctx.moveTo(ax + ux * arrowSize, ay + uy * arrowSize);
            ctx.lineTo(ax - ux * arrowSize + uy * arrowSize * 0.6, ay - uy * arrowSize - ux * arrowSize * 0.6);
            ctx.lineTo(ax - ux * arrowSize - uy * arrowSize * 0.6, ay - uy * arrowSize + ux * arrowSize * 0.6);
            ctx.closePath();
            ctx.fillStyle = isDarkMode
                ? 'rgba(0, 212, 255, 0.6)'
                : 'rgba(0, 140, 200, 0.5)';
            ctx.fill();
        }
    }, [isDarkMode, trailEdgeSet, walkerColor]);

    // ── Force engine configuration ──────────────────────────────────────────

    // Configure force simulation ONCE on mount — don't reheat on every data change
    // (reheating on data change breaks drag + causes nodes to fly away)
    const nodeCount = data?.nodes?.length || 0;
    useEffect(() => {
        const fg = graphRef.current;
        if (!fg) return;

        const charge = fg.d3Force('charge');
        if (charge) {
            // Stronger repulsion + longer range so nodes don't settle into a grid.
            // With the previous distanceMax(300) clip and weak -80 strength, nodes
            // past 300 units had NO repulsion, which produces uniform spacing.
            charge.strength(-160);
            charge.distanceMax(800);
            if (typeof charge.theta === 'function') charge.theta(0.9);
        }

        const link = fg.d3Force('link');
        if (link) {
            // Wider variance in link distance creates visible clusters
            link.distance((l) => {
                const strength = l.strength ?? 0.5;
                return 20 + (1 - strength) * 90;
            });
            link.strength((l) => {
                const strength = l.strength ?? 0.5;
                return 0.15 + strength * 0.85;
            });
            if (typeof link.iterations === 'function') link.iterations(2);
        }

        const center = fg.d3Force('center');
        if (center) {
            center.strength(0.03);
        }

        fg.d3ReheatSimulation();
    }, [nodeCount > 0]); // Only re-run when we go from 0 nodes to having nodes

    // ── Zoom to fit on initial load (multiple attempts to ensure centering) ──

    // Zoom to fit once on initial load only (not every data change)
    useEffect(() => {
        const fg = graphRef.current;
        if (!fg || nodeCount === 0) return;

        const fit = () => fg.zoomToFit(600, 40);
        const t1 = setTimeout(fit, 300);
        const t2 = setTimeout(fit, 1500);
        const t3 = setTimeout(fit, 3000);

        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }, [nodeCount > 0]);

    // ── Zoom to fit on external trigger (after ingestion) ──
    useEffect(() => {
        if (zoomToFitTrigger === 0) return;
        const fg = graphRef.current;
        if (fg) fg.zoomToFit(600, 40);
    }, [zoomToFitTrigger]);

    // ── Event handlers ──────────────────────────────────────────────────────

    const handleNodeClick = useCallback((node, event) => {
        if (onNodeClick) onNodeClick(node, event);
    }, [onNodeClick]);

    // Store hovered node in a ref so hover doesn't trigger React re-renders
    // (re-rendering GraphView during drag causes inline ForceGraph2D prop fns to
    // change refs, which resets internal link processing and makes nodes vanish).
    const hoverNodeRef = useRef(null);
    const handleNodeHover = useCallback((node) => {
        hoverNodeRef.current = node || null;
        setHoverNode(node || null); // still update state so paintNode redraws hover ring
        const el = document.querySelector('.graph-view canvas');
        if (el) {
            el.style.cursor = node ? 'pointer' : 'default';
        }
    }, []);

    // Stable refs for all ForceGraph2D function props. These MUST NOT be inline
    // in JSX -- inline fns change identity every render, which causes
    // react-force-graph to reprocess link source/target resolution and
    // can wipe rendered nodes during drag interactions.
    const nodeCanvasObjectModeRef = useCallback(() => 'replace', []);
    const linkCanvasObjectModeRef = useCallback(() => 'replace', []);
    const emptyLabelRef = useCallback(() => '', []);
    const nodePointerAreaPaintRef = useCallback((node, color, ctx) => {
        if (!isFinite(node.x) || !isFinite(node.y)) return;
        const importance = node.importance ?? 0.5;
        const hitRadius = 5 + importance * 6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, hitRadius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
    }, []);

    // Stable particle prop functions (depend only on trailEdgeSet + walkerColor)
    const linkDirectionalParticlesFn = useCallback((link) => {
        if (link.type === 'inspired_by') return 3;
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (trailEdgeSet && trailEdgeSet.has(`${sourceId}__${targetId}`)) return 5;
        return 0;
    }, [trailEdgeSet]);
    const linkDirectionalParticleWidthFn = useCallback((link) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (trailEdgeSet && trailEdgeSet.has(`${sourceId}__${targetId}`)) return 4;
        return 2;
    }, [trailEdgeSet]);
    const linkDirectionalParticleColorFn = useCallback((link) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        if (trailEdgeSet && trailEdgeSet.has(`${sourceId}__${targetId}`)) return walkerColor;
        return '#FFD700';
    }, [trailEdgeSet, walkerColor]);

    // ── Derived graph data with defaults ────────────────────────────────────

    // Stable reference — only rebuild when nodes/links arrays actually change
    const graphData = useMemo(() => {
        if (!data) return { nodes: [], links: [] };
        return {
            nodes: data.nodes || [],
            links: data.links || data.edges || [],
        };
    }, [data?.nodes, data?.links]);

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <div
            className={`graph-view ${isDarkMode ? 'graph-view--dark' : 'graph-view--light'}`}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'visible',
            }}
        >
            {/* Deep space background — layered gradients for nebula depth */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: isDarkMode
                        ? `
                            radial-gradient(ellipse 60% 50% at 30% 40%, rgba(40, 30, 90, 0.35) 0%, transparent 60%),
                            radial-gradient(ellipse 70% 60% at 75% 65%, rgba(20, 60, 120, 0.28) 0%, transparent 55%),
                            radial-gradient(ellipse 50% 40% at 85% 15%, rgba(120, 40, 140, 0.20) 0%, transparent 55%),
                            radial-gradient(ellipse at 50% 50%, #0c0c24 0%, #070716 45%, #04040c 100%)
                        `
                        : BG_LIGHT,
                    zIndex: 0,
                }}
            />

            {/* Subtle nebula/aurora wash */}
            {isDarkMode && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                    background: `
                        radial-gradient(ellipse 40% 30% at 20% 80%, rgba(0, 180, 220, 0.06) 0%, transparent 70%),
                        radial-gradient(ellipse 35% 25% at 80% 30%, rgba(180, 100, 255, 0.05) 0%, transparent 70%)
                    `,
                    mixBlendMode: 'screen',
                }} />
            )}

            {/* Dense starfield — many bright stars, repeating tile for coverage */}
            {isDarkMode && (
                <>
                    {/* Layer 1: small stars, dense, fast twinkle */}
                    <div className="graph-starfield" style={{
                        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                        opacity: 1,
                        animation: 'starfield-twinkle 7s ease-in-out infinite',
                        backgroundSize: '250px 250px',
                        backgroundImage: `
                            radial-gradient(1.2px 1.2px at 15px 38px, rgba(255,255,255,1), transparent 55%),
                            radial-gradient(1.2px 1.2px at 80px 15px, rgba(200,220,255,1), transparent 55%),
                            radial-gradient(1.5px 1.5px at 140px 60px, rgba(255,255,255,1), transparent 55%),
                            radial-gradient(1.2px 1.2px at 50px 110px, rgba(230,240,255,1), transparent 55%),
                            radial-gradient(1.2px 1.2px at 175px 90px, rgba(255,255,255,0.95), transparent 55%),
                            radial-gradient(1.5px 1.5px at 220px 40px, rgba(200,220,255,1), transparent 55%),
                            radial-gradient(1.2px 1.2px at 100px 175px, rgba(255,255,255,0.9), transparent 55%),
                            radial-gradient(1.2px 1.2px at 200px 160px, rgba(230,240,255,0.95), transparent 55%),
                            radial-gradient(1.5px 1.5px at 30px 200px, rgba(255,255,255,1), transparent 55%),
                            radial-gradient(1.2px 1.2px at 125px 125px, rgba(200,220,255,0.9), transparent 55%),
                            radial-gradient(1.2px 1.2px at 165px 220px, rgba(255,255,255,0.95), transparent 55%),
                            radial-gradient(1.5px 1.5px at 60px 75px, rgba(255,255,255,1), transparent 55%),
                            radial-gradient(1.2px 1.2px at 235px 210px, rgba(230,240,255,0.9), transparent 55%)
                        `,
                    }} />
                    {/* Layer 2: medium stars, slower twinkle, shimmer color */}
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                        opacity: 0.95,
                        animation: 'starfield-twinkle 12s ease-in-out infinite 1.5s',
                        backgroundSize: '400px 400px',
                        backgroundImage: `
                            radial-gradient(2px 2px at 60px 80px, rgba(255,240,220,1), transparent 60%),
                            radial-gradient(2px 2px at 220px 150px, rgba(200,220,255,1), transparent 60%),
                            radial-gradient(2.5px 2.5px at 340px 50px, rgba(255,255,255,1), transparent 60%),
                            radial-gradient(2px 2px at 120px 290px, rgba(220,200,255,1), transparent 60%),
                            radial-gradient(2px 2px at 280px 340px, rgba(255,240,220,1), transparent 60%),
                            radial-gradient(2.5px 2.5px at 380px 230px, rgba(255,255,255,1), transparent 60%),
                            radial-gradient(2px 2px at 30px 200px, rgba(200,220,255,1), transparent 60%)
                        `,
                    }} />
                    {/* Layer 3: large bright stars, slowest twinkle, gold/amber */}
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                        opacity: 1,
                        animation: 'starfield-twinkle 18s ease-in-out infinite 3s',
                        backgroundSize: '700px 700px',
                        backgroundImage: `
                            radial-gradient(3px 3px at 150px 200px, rgba(255,240,200,1), transparent 65%),
                            radial-gradient(3px 3px at 500px 120px, rgba(255,220,230,1), transparent 65%),
                            radial-gradient(3.5px 3.5px at 620px 450px, rgba(200,220,255,1), transparent 65%),
                            radial-gradient(3px 3px at 80px 550px, rgba(255,255,240,1), transparent 65%),
                            radial-gradient(3px 3px at 350px 620px, rgba(255,240,220,1), transparent 65%)
                        `,
                    }} />
                </>
            )}

            <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%' }}>
                <ForceGraph2D
                    ref={graphRef}
                    graphData={graphData}
                    nodeCanvasObject={paintNode}
                    nodeCanvasObjectMode={nodeCanvasObjectModeRef}
                    nodeLabel={emptyLabelRef}
                    nodePointerAreaPaint={nodePointerAreaPaintRef}
                    linkCanvasObject={paintLink}
                    linkCanvasObjectMode={linkCanvasObjectModeRef}
                    linkLabel={emptyLabelRef}
                    nodeId="id"
                    onNodeClick={handleNodeClick}
                    onNodeHover={handleNodeHover}
                    backgroundColor="transparent"
                    linkDirectionalParticles={linkDirectionalParticlesFn}
                    linkDirectionalParticleWidth={linkDirectionalParticleWidthFn}
                    linkDirectionalParticleSpeed={0.008}
                    linkDirectionalParticleColor={linkDirectionalParticleColorFn}
                    cooldownTime={15000}
                    warmupTicks={100}
                    d3AlphaDecay={0.015}
                    d3VelocityDecay={0.35}
                    enableNodeDrag={true}
                    enableZoomInteraction={true}
                    enablePanInteraction={true}
                    minZoom={0.3}
                    maxZoom={12}
                />
            </div>

            {/* Node count badge */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 12,
                    left: 12,
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: '"Inter", "SF Pro Display", -apple-system, sans-serif',
                    fontWeight: 500,
                    letterSpacing: '0.03em',
                    background: isDarkMode
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(0, 0, 0, 0.04)',
                    color: isDarkMode
                        ? 'rgba(255, 255, 255, 0.45)'
                        : 'rgba(0, 0, 0, 0.4)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: isDarkMode
                        ? '1px solid rgba(255, 255, 255, 0.05)'
                        : '1px solid rgba(0, 0, 0, 0.06)',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    zIndex: 2,
                }}
            >
                {graphData.nodes.length} nodes &middot; {graphData.links.length} edges
                {trailSet ? ` \u00B7 walker active` : ''}
            </div>
        </div>
    );
}
