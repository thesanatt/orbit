import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import GraphView from './components/GraphView';
import QueryBar from './components/QueryBar';
import IngestPanel from './components/IngestPanel';
import InsightFeed from './components/InsightFeed';
import NodeDetail from './components/NodeDetail';
import WalkerTrail from './components/WalkerTrail';
import { loadGraph, saveNode, saveEdge, syncGraphToInsForge, getUserId, wipeUserData, saveInsight, subscribeToRealtimeUpdates, publishRealtimeUpdate } from './insforge.js';
import { jacAuth, jacHealthCheck, jacSeedGraph, jacGetGraph, jacExplore, jacAskQuestion, jacIngest } from './jac_api.js';
import './styles/night.css';
import './styles/animations.css';

/**
 * ORBIT -- Your Second Brain That Actually Thinks
 *
 * Main application shell. Manages global state for the knowledge graph,
 * walker animations, and panel interactions.
 */
export default function App() {
    const [graphData, setGraphData] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [walkerTrail, setWalkerTrail] = useState(null);
    const [activeWalker, setActiveWalker] = useState(null);
    const [insights, setInsights] = useState([]);
    const [isDarkMode] = useState(true); // Always dark mode
    const [answer, setAnswer] = useState(null);
    const [isIngesting, setIsIngesting] = useState(false);
    const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
    const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
    const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0);
    const [jacAvailable, setJacAvailable] = useState(false);
    const [insforgeStatus, setInsforgeStatus] = useState('idle'); // idle | syncing | synced | error
    const userIdRef = useRef(null);
    const [realtimeStatus, setRealtimeStatus] = useState('offline'); // offline | live
    const [recentRealtimeEvent, setRecentRealtimeEvent] = useState(null);

    const stats = useMemo(() => {
        const nodes = graphData?.nodes || [];
        const links = graphData?.links || [];
        return {
            concepts: nodes.filter(n => n.type === 'Concept').length,
            sources: nodes.filter(n => n.type === 'Source').length,
            connections: links.length,
            insights: nodes.filter(n => n.type === 'Insight').length,
            people: nodes.filter(n => n.type === 'Person').length,
            projects: nodes.filter(n => n.type === 'Project').length,
        };
    }, [graphData]);

    // Guard: StrictMode in dev runs effects twice; prevent double-seeding
    const didLoadRef = useRef(false);

    // Load demo data on mount
    useEffect(() => {
        if (didLoadRef.current) return;
        didLoadRef.current = true;
        loadDemoData();
    }, []);

    const loadDemoData = async () => {
        try {
            let data = null;

            // Try Jac backend first (real walker-powered graph)
            const jacUp = await jacHealthCheck();
            if (jacUp) {
                setJacAvailable(true);
                await jacAuth();

                // Check if graph is already seeded — only seed if empty.
                // SeedGraph is NOT idempotent (adds nodes on each call), so we
                // must gate it to avoid duplicates across sessions or reloads.
                let graphResult = await jacGetGraph();
                if (!graphResult?.nodes || graphResult.nodes.length === 0) {
                    console.log('[ORBIT] Graph empty, seeding...');
                    await jacSeedGraph();
                    graphResult = await jacGetGraph();
                }

                if (graphResult?.nodes && graphResult.nodes.length > 0) {
                    data = { nodes: graphResult.nodes, edges: graphResult.edges };
                    console.log(`[ORBIT] Loaded ${data.nodes.length} nodes from Jac backend (live walkers)`);
                }
            }

            // Fallback: local JSON (authoritative source of truth)
            if (!data) {
                const response = await fetch('/data/demo_knowledge.json');
                data = await response.json();
                console.log('[ORBIT] Loaded from local JSON');
            }

            const nodes = (data.nodes || []).map(n => ({
                id: n.id,
                name: n.name || n.title || n.text || 'Untitled',
                type: n.type || 'Concept',
                description: n.description || n.summary || '',
                domain: n.domain || 'general',
                importance: n.importance || 0.5,
                depth: n.depth || 'surface',
                accessCount: n.access_count || 0,
                lastAccessed: n.last_accessed || Date.now() / 1000,
                createdAt: n.created_at || Date.now() / 1000,
                ...n,
            }));

            // Build node ID set to filter out orphan edges
            const nodeIds = new Set(nodes.map(n => n.id));
            const links = (data.edges || [])
                .map((e, i) => ({
                    id: e.id || `edge_${i}`,
                    source: e.source,
                    target: e.target,
                    type: e.type || e.edge_type || 'relates_to',
                    strength: e.strength || 0.5,
                    relationship: e.relationship || '',
                    ...e,
                }))
                .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

            setGraphData({ nodes, links });

            // Extract insights from nodes
            const insightNodes = nodes.filter(n => n.type === 'Insight');
            const extractedInsights = insightNodes.map(n => ({
                id: n.id,
                title: n.name,
                description: n.description,
                confidence: n.confidence || 0.8,
                path: n.path || [],
                generatedAt: n.generated_at || Date.now() / 1000,
                validated: n.validated || false,
            }));
            setInsights(extractedInsights);

            // === InsForge sync: wipe stale, bulk upload current state ===
            const userId = getUserId();
            userIdRef.current = userId;
            setInsforgeStatus('syncing');
            (async () => {
                try {
                    await wipeUserData(userId); // avoid stale references from prior sessions
                    const ok = await syncGraphToInsForge(nodes, links, userId);
                    setInsforgeStatus(ok ? 'synced' : 'error');
                } catch {
                    setInsforgeStatus('error');
                }
            })();

        } catch (err) {
            console.error('Failed to load demo data:', err);
        }
    };

    // Build adjacency list for BFS pathfinding
    const adjacency = useMemo(() => {
        const adj = {};
        for (const link of (graphData?.links || [])) {
            const s = typeof link.source === 'object' ? link.source.id : link.source;
            const t = typeof link.target === 'object' ? link.target.id : link.target;
            if (!adj[s]) adj[s] = [];
            if (!adj[t]) adj[t] = [];
            adj[s].push(t);
            adj[t].push(s);
        }
        return adj;
    }, [graphData]);

    // Node lookup by ID
    const nodeById = useMemo(() => {
        const map = {};
        for (const n of (graphData?.nodes || [])) map[n.id] = n;
        return map;
    }, [graphData]);

    /**
     * Background-save a node to InsForge + broadcast to other tabs via realtime.
     */
    const persistNode = useCallback((node) => {
        const uid = userIdRef.current;
        if (!uid) return;
        setInsforgeStatus('syncing');
        saveNode(node, uid).then(r => setInsforgeStatus(r ? 'synced' : 'error'));
        publishRealtimeUpdate(uid, 'orbit_node_added', { node });
    }, []);

    /**
     * Background-save an edge to InsForge + broadcast to other tabs.
     */
    const persistEdge = useCallback((edge) => {
        const uid = userIdRef.current;
        if (!uid) return;
        setInsforgeStatus('syncing');
        saveEdge(edge, uid).then(r => setInsforgeStatus(r ? 'synced' : 'error'));
        publishRealtimeUpdate(uid, 'orbit_edge_added', { edge });
    }, []);

    /**
     * Background-save an insight to InsForge + broadcast to other tabs.
     */
    const persistInsight = useCallback((insight) => {
        const uid = userIdRef.current;
        if (!uid) return;
        setInsforgeStatus('syncing');
        saveInsight(insight, uid).then(r => setInsforgeStatus(r ? 'synced' : 'error'));
        publishRealtimeUpdate(uid, 'orbit_insight_added', { insight });
    }, []);

    /**
     * Reinforce edges after a walker traverses a path (spaced-repetition effect).
     * Direct path edges get +0.15. Any OTHER edge touching a visited node gets +0.04
     * (associative activation — revisiting a concept spreads to nearby memories).
     */
    const reinforcePath = useCallback((pathIds) => {
        if (!pathIds || pathIds.length < 2) return;
        setGraphData(prev => {
            if (!prev) return prev;
            const pathEdgeSet = new Set();
            for (let i = 0; i < pathIds.length - 1; i++) {
                pathEdgeSet.add(`${pathIds[i]}_${pathIds[i+1]}`);
                pathEdgeSet.add(`${pathIds[i+1]}_${pathIds[i]}`);
            }
            const visitedNodes = new Set(pathIds);
            return {
                nodes: prev.nodes,
                links: prev.links.map(l => {
                    const s = typeof l.source === 'object' ? l.source.id : l.source;
                    const t = typeof l.target === 'object' ? l.target.id : l.target;
                    if (pathEdgeSet.has(`${s}_${t}`)) {
                        return { ...l, strength: Math.min(1.0, (l.strength || 0.5) + 0.15) };
                    }
                    // Associative reinforcement: edge touches a visited node but isn't on the path
                    if (visitedNodes.has(s) || visitedNodes.has(t)) {
                        return { ...l, strength: Math.min(1.0, (l.strength || 0.5) + 0.04) };
                    }
                    return l;
                }),
            };
        });
    }, []);

    /**
     * Append a new discovery to the insight feed. Deduplicates by title+path,
     * and tags cross-domain walks as high-confidence.
     */
    const addInsight = useCallback((title, description, pathIds, source) => {
        if (!pathIds || pathIds.length < 2 || !description) return;
        const pathKey = pathIds.join('>');

        // Compute confidence: cross-domain + longer paths = more surprising
        const pathNodes = pathIds.map(id => nodeById[id]).filter(Boolean);
        const domains = new Set(pathNodes.map(n => n.domain).filter(Boolean));
        const crossDomain = domains.size >= 2;
        const baseConf = source === 'surprise' ? 0.85 : 0.70;
        const confidence = Math.min(0.98, baseConf + (crossDomain ? 0.10 : 0) + Math.min(0.05, pathIds.length * 0.01));

        let created = null;
        setInsights(prev => {
            // Dedup: skip if same path already saved
            if (prev.some(i => (i.path || []).join('>') === pathKey)) return prev;
            created = {
                id: `insight_${source}_${Date.now()}`,
                title,
                description,
                confidence,
                path: pathIds,
                generatedAt: Date.now() / 1000,
                validated: false,
                source, // 'pathfinder' | 'surprise' | 'explorer'
            };
            // Newest first, cap at 50 to keep the feed manageable
            return [created, ...prev].slice(0, 50);
        });
        if (created) persistInsight(created);
    }, [nodeById, persistInsight]);

    /**
     * Background Explorer walker — runs every 75s when Jac is live, performs
     * a 6-hop random walk over the graph, generates a cross-domain insight,
     * and appends it to the feed. This is the "runs while you sleep" moment.
     */
    useEffect(() => {
        if (!jacAvailable || !graphData?.nodes?.length) return;

        // Name -> ID lookup for resolving discovery paths
        const nameToId = {};
        for (const n of graphData.nodes) {
            nameToId[(n.name || '').toLowerCase()] = n.id;
        }

        let cancelled = false;
        const runOnce = async () => {
            try {
                const result = await jacExplore(6, 0.4);
                if (cancelled || !result) return;
                const discoveries = result.discoveries || [];
                for (const disc of discoveries) {
                    const pathNames = disc.path || [];
                    const pathIds = pathNames.map(n => nameToId[(n || '').toLowerCase()]).filter(Boolean);
                    if (pathIds.length >= 2 && disc.description) {
                        addInsight(
                            disc.title || 'Background discovery',
                            disc.description,
                            pathIds,
                            'explorer'
                        );
                    }
                }
            } catch (e) { /* network blip, try again next tick */ }
        };

        // First run after 15s (give UI time to settle), then every 75s
        const initial = setTimeout(runOnce, 15000);
        const interval = setInterval(runOnce, 75000);
        return () => { cancelled = true; clearTimeout(initial); clearInterval(interval); };
    }, [jacAvailable, graphData?.nodes?.length, addInsight]);

    /**
     * InsForge realtime subscription — listens for updates to the user's graph
     * from OTHER tabs/browsers (open the app in 2 tabs to demo live sync).
     * Applies remote node/edge/insight events to local state.
     */
    useEffect(() => {
        if (!userIdRef.current || !graphData) return;
        let cleanup = () => {};
        (async () => {
            cleanup = await subscribeToRealtimeUpdates(userIdRef.current, (eventType, payload) => {
                setRealtimeStatus('live');
                setRecentRealtimeEvent({ type: eventType, at: Date.now() });

                if (eventType === 'orbit_node_added' && payload.node) {
                    setGraphData(prev => {
                        if (!prev) return prev;
                        // Dedup: skip if node already exists
                        if (prev.nodes.some(n => n.id === payload.node.id)) return prev;
                        return { nodes: [...prev.nodes, { ...payload.node, isNew: true }], links: prev.links };
                    });
                    // Clear isNew flash after 2s
                    setTimeout(() => {
                        setGraphData(prev => {
                            if (!prev) return prev;
                            for (const n of prev.nodes) { if (n.id === payload.node.id) n.isNew = false; }
                            return { nodes: [...prev.nodes], links: prev.links };
                        });
                    }, 2000);
                } else if (eventType === 'orbit_edge_added' && payload.edge) {
                    setGraphData(prev => {
                        if (!prev) return prev;
                        if (prev.links.some(l => l.id === payload.edge.id)) return prev;
                        return { nodes: prev.nodes, links: [...prev.links, payload.edge] };
                    });
                } else if (eventType === 'orbit_insight_added' && payload.insight) {
                    setInsights(prev => {
                        if (prev.some(i => i.id === payload.insight.id)) return prev;
                        return [payload.insight, ...prev].slice(0, 50);
                    });
                }
            });
            setRealtimeStatus('live');
        })();
        return () => {
            cleanup();
            setRealtimeStatus('offline');
        };
    }, [userIdRef.current && graphData ? 'on' : 'off']);

    // BFS between two node IDs, returns array of IDs or null
    const bfsPath = useCallback((startId, endId) => {
        if (startId === endId) return [startId];
        const visited = new Set([startId]);
        const queue = [[startId]];
        while (queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];
            for (const neighbor of (adjacency[current] || [])) {
                if (neighbor === endId) return [...path, neighbor];
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    if (path.length < 10) queue.push([...path, neighbor]);
                }
            }
        }
        return null;
    }, [adjacency]);

    // Find nodes matching query words (with stop word filtering)
    const STOP_WORDS = new Set(['does','have','that','this','what','with','from','they','their','then',
        'than','them','these','those','been','being','were','will','would','could','should','about',
        'after','before','between','into','through','during','above','below','each','every','some',
        'such','only','also','just','like','make','know','think','want','come','take','find','give',
        'tell','work','call','help','connect','relate','link','connection','between','how']);
    const findMatchingNodes = useCallback((question) => {
        const qLower = question.toLowerCase().replace(/[?.,!]/g, '');
        const words = qLower.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
        // Search all node types, not just Concepts
        // Search ALL node types — Persons (Andrew Huberman), Projects, Insights
        // are legit anchors too, not just Concepts/Sources.
        const searchable = (graphData?.nodes || []).filter(n =>
            n.type === 'Concept' || n.type === 'Source' ||
            n.type === 'Person' || n.type === 'Project' || n.type === 'Insight'
        );
        const scored = searchable.map(n => {
            const name = (n.name || '').toLowerCase();
            const desc = (n.description || '').toLowerCase();
            const domain = (n.domain || '').toLowerCase();
            let score = 0;
            // Full phrase match (highest priority)
            if (name.includes(qLower) || qLower.includes(name)) score += 20;
            // Multi-word subsequence: "african lions" in node name
            for (let i = 0; i < words.length - 1; i++) {
                const bigram = words[i] + ' ' + words[i + 1];
                if (name.includes(bigram)) score += 15;
            }
            // Single word matches
            for (const w of words) {
                if (name.includes(w)) score += 5;
                else if (domain.includes(w)) score += 3;
                else if (desc.includes(w)) score += 1;
            }
            // Exact word match in node name (as separate word) is much stronger than
            // substring match — e.g. "Obama" as a name-word is a real hit, not "obamacare".
            const nameWords = name.split(/\s+/);
            for (const w of words) {
                if (nameWords.includes(w)) score += 6;
            }
            // Prefer entity types (Person, Project, Insight) over Source notes on ties:
            // a Person named "Barack Obama" is a better anchor than a Source note that
            // happens to mention obama.
            if (score > 0) {
                if (n.type === 'Person' || n.type === 'Project' || n.type === 'Insight') score += 3;
                else if (n.type === 'Source') score -= 1;
            }
            return { node: n, score };
        }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
        return scored.map(s => s.node);
    }, [graphData]);

    /**
     * Handle a user question. First checks if a pre-built insight matches,
     * then falls back to BFS pathfinding with simple language.
     */
    const handleQuery = useCallback(async (question) => {
        setAnswer({ loading: true, question, text: '' });
        setActiveWalker('pathfinder');

        try {
            // === TRY LIVE JAC PATHFINDER FIRST ===
            if (jacAvailable) {
                try {
                    const walkerResult = await jacAskQuestion(question);
                    if (walkerResult) {
                        let path = walkerResult.answer_path || walkerResult.traversal_path || [];
                        const answer = walkerResult.answer || walkerResult.best_answer || '';

                        // Resolve Jac path names to frontend node IDs (no filter yet)
                        const nameToId = {};
                        for (const n of (graphData?.nodes || [])) {
                            nameToId[(n.name || '').toLowerCase()] = n.id;
                        }
                        const rawIds = path.map(name => nameToId[(name || '').toLowerCase()]);

                        // VALIDATE: every node must resolve AND every consecutive pair must be a real edge
                        const allResolved = rawIds.length > 0 && rawIds.every(Boolean);
                        let pathValid = allResolved;
                        if (allResolved) {
                            for (let i = 0; i < rawIds.length - 1; i++) {
                                const neighbors = adjacency[rawIds[i]] || [];
                                if (!neighbors.includes(rawIds[i + 1])) { pathValid = false; break; }
                            }
                        }

                        if (!pathValid) {
                            console.log('[ORBIT] Jac path invalid (missing nodes or non-adjacent hops), falling back to BFS. Path:', path);
                            throw new Error('jac_path_invalid');
                        }

                        // ANCHOR CHECK: the path must contain the concepts the user asked about.
                        // Jac's Pathfinder only visits Concepts, so it misses Persons/Projects/Insights
                        // entirely. Reject any Jac path that doesn't include at least ONE of the
                        // anchors the user's question points to.
                        const questionMatches = findMatchingNodes(question);
                        if (questionMatches.length >= 1) {
                            const pathIdSet = new Set(rawIds);
                            const anchorA = questionMatches[0].id;
                            const hasA = pathIdSet.has(anchorA);

                            if (questionMatches.length >= 2) {
                                // If the user explicitly named both top matches in the
                                // question, use them as-is. Otherwise prefer an anchorB
                                // from a different domain for cross-domain questions.
                                let anchorB = questionMatches[1].id;
                                const qL = question.toLowerCase();
                                const nameIn = (n) => {
                                    if (!n || !(n.name || '').length) return false;
                                    const words = (n.name || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
                                    return words.some(w => qL.includes(w));
                                };
                                const bothNamed = nameIn(questionMatches[0]) && nameIn(questionMatches[1]);
                                if (!bothNamed) {
                                    for (let i = 1; i < questionMatches.length; i++) {
                                        if (questionMatches[i].domain !== questionMatches[0].domain) {
                                            anchorB = questionMatches[i].id; break;
                                        }
                                    }
                                }
                                const hasB = pathIdSet.has(anchorB);
                                if (!hasA || !hasB) {
                                    console.log('[ORBIT] Jac path missing both anchors', {
                                        anchors: [questionMatches[0].name, nodeById[anchorB]?.name],
                                        jacPath: path
                                    });
                                    throw new Error('jac_path_missing_anchors');
                                }
                            } else if (!hasA) {
                                // single anchor known; path must at least reach it
                                console.log('[ORBIT] Jac path does not reach the single anchor', {
                                    anchor: questionMatches[0].name,
                                    jacPath: path
                                });
                                throw new Error('jac_path_missing_anchor');
                            }
                        }

                        // Cap path to 6 nodes for clean visualization (keep start, end, 3 middle samples)
                        let pathIds = rawIds;
                        if (pathIds.length > 6) {
                            const L = pathIds.length;
                            pathIds = [pathIds[0], pathIds[Math.floor(L/4)], pathIds[Math.floor(L/2)], pathIds[Math.floor(3*L/4)], pathIds[L-1]];
                            // But now verify the capped path still has valid edges (it likely won't) — if not, use full path
                            let stillValid = true;
                            for (let i = 0; i < pathIds.length - 1; i++) {
                                if (!(adjacency[pathIds[i]] || []).includes(pathIds[i+1])) { stillValid = false; break; }
                            }
                            if (!stillValid) pathIds = rawIds; // keep full path
                        }

                        setWalkerTrail({ walkerType: 'pathfinder', nodeIds: pathIds, currentStep: 0, speed: 500 });
                        for (let i = 0; i < pathIds.length; i++) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                            setWalkerTrail(prev => prev ? { ...prev, currentStep: i } : null);
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));

                        const pathNames = pathIds.map(id => nodeById[id]?.name || id);
                        reinforcePath(pathIds);

                        // If Jac's answer is the short-path fallback ("intermediate concepts"),
                        // request a real LLM explanation from our Groq endpoint instead.
                        let finalText = answer || `Path: ${pathNames.join(' \u2192 ')}`;
                        const isGenericFallback = answer && (
                            answer.includes('intermediate concepts') ||
                            answer.includes('This traversal connects') ||
                            answer.trim().length < 80
                        );
                        if (!answer || isGenericFallback) {
                            setAnswer({ loading: true, question, text: 'Synthesizing explanation...', path: pathNames });
                            try {
                                const pathContext = pathIds.map(id => {
                                    const n = nodeById[id];
                                    return n ? { name: n.name, description: n.description || '' } : { name: id, description: '' };
                                });
                                const resp = await fetch('http://localhost:3001/api/ask', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ question, path_nodes: pathContext }),
                                });
                                const data = await resp.json();
                                if (data.answer) finalText = data.answer;
                            } catch (e) { /* fall back to Jac's answer */ }
                        }
                        setAnswer({
                            loading: false, question,
                            text: finalText,
                            path: pathNames,
                        });
                        addInsight(question, finalText, pathIds, 'pathfinder');
                        setActiveWalker(null);
                        return; // Success — don't fall through to BFS
                    }
                } catch (e) {
                    console.log('[ORBIT] Jac Pathfinder failed, falling back to client BFS:', e.message);
                }
            }

            // === FALLBACK: Client-side BFS ===
            const qLower = question.toLowerCase();

            // First: check if any pre-built insight matches the question (pick BEST match)
            const insightNodes = (graphData?.nodes || []).filter(n => n.type === 'Insight');
            const qWords = qLower.split(/\s+/).filter(w => w.length > 3);
            let matchedInsight = null;
            let bestHits = 0;
            for (const ins of insightNodes) {
                const title = (ins.name || ins.title || '').toLowerCase();
                const desc = (ins.description || '').toLowerCase();
                let hits = 0;
                for (const w of qWords) {
                    if (title.includes(w)) hits += 2; // title match worth more
                    else if (desc.includes(w)) hits += 1;
                }
                if (hits > bestHits && hits >= 3) {
                    bestHits = hits;
                    matchedInsight = ins;
                }
            }

            let pathIds, answerText;

            if (matchedInsight && matchedInsight.path && matchedInsight.path.length > 0) {
                // Use the insight's pre-built path and human-written description
                pathIds = matchedInsight.path;
                answerText = matchedInsight.description;
            } else {
                // Step 1: Find matching nodes - need good matches, not random ones
                const matches = findMatchingNodes(question);

                if (matches.length === 0) {
                    // === AUTO-EXPAND: the question is conceptual, graph has none of these concepts yet.
                    // Extract concepts from the question, add them to the graph, connect them to
                    // relevant existing nodes, then try again.
                    setAnswer({ loading: false, question, text: 'Expanding your graph with the concepts in your question...', path: [] });

                    let extracted = [];
                    try {
                        const resp = await fetch('http://localhost:3001/api/ingest', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: question, source_type: 'question' }),
                        });
                        const data = await resp.json();
                        extracted = (data.concepts || []).slice(0, 3);
                    } catch (e) {
                        setAnswer({ loading: false, question, text: "Can't reach the API server to expand your graph. Start it with ./reboot.sh api.", path: [] });
                        setActiveWalker(null);
                        return;
                    }

                    if (extracted.length < 2) {
                        setAnswer({ loading: false, question, text: "Couldn't extract enough concepts from your question to build a path.", path: [] });
                        setActiveWalker(null);
                        return;
                    }

                    // Build new Concept nodes
                    const ts = Date.now() / 1000;
                    const newNodes = extracted.map((c, i) => ({
                        id: `concept_q_${Date.now()}_${i}`,
                        name: c.name || `Concept ${i + 1}`,
                        type: 'Concept',
                        description: c.description || '',
                        domain: c.domain || 'from_question',
                        importance: 0.45,
                        depth: 'surface',
                        createdAt: ts, lastAccessed: ts, accessCount: 1,
                        isNew: true,
                    }));

                    // Connect each new concept to existing graph via LLM
                    const existingConcepts = (graphData?.nodes || []).filter(n => n.type === 'Concept');
                    let connections = [];
                    try {
                        const connResp = await fetch('http://localhost:3001/api/connect', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                new_concepts: newNodes.map(n => ({ name: n.name, description: n.description })),
                                existing_nodes: existingConcepts.map(n => ({ name: n.name, id: n.id })),
                            }),
                        });
                        const connData = await connResp.json();
                        connections = connData.connections || [];
                    } catch (e) { /* ok, proceed without connections */ }

                    // Resolve LLM-returned name strings back to node IDs
                    const nameLookup = {};
                    for (const n of existingConcepts) nameLookup[(n.name || '').toLowerCase().trim()] = n.id;
                    for (const n of newNodes) nameLookup[(n.name || '').toLowerCase().trim()] = n.id;

                    const newLinks = [];
                    for (const conn of connections) {
                        const srcId = nameLookup[(conn.source || '').toLowerCase().trim()];
                        const tgtId = nameLookup[(conn.target || '').toLowerCase().trim()];
                        if (srcId && tgtId && srcId !== tgtId) {
                            newLinks.push({
                                id: `link_q_${Date.now()}_${newLinks.length}`,
                                source: srcId, target: tgtId, type: 'relates_to',
                                strength: 0.55, relationship: conn.relationship || 'from question context',
                            });
                        }
                    }

                    // Ensure every new concept has at least ONE connection so nothing dangles:
                    // for any new concept with no edges, link to its best word-overlap neighbor
                    const connectedIds = new Set(newLinks.flatMap(l => [l.source, l.target]));
                    for (const nc of newNodes) {
                        if (connectedIds.has(nc.id)) continue;
                        const ncWords = new Set((nc.name + ' ' + nc.description).toLowerCase().split(/\s+/).filter(w => w.length > 3));
                        let best = null, bestScore = 0;
                        for (const ex of existingConcepts) {
                            const exText = (ex.name + ' ' + (ex.description || '')).toLowerCase().split(/\s+/);
                            const score = exText.filter(w => ncWords.has(w)).length;
                            if (score > bestScore) { bestScore = score; best = ex; }
                        }
                        const target = best || existingConcepts[0];
                        if (target) {
                            newLinks.push({
                                id: `link_q_fb_${Date.now()}_${nc.id}`,
                                source: nc.id, target: target.id, type: 'relates_to',
                                strength: bestScore > 0 ? 0.45 : 0.30,
                                relationship: bestScore > 0 ? 'semantically related' : 'bridging',
                            });
                        }
                    }

                    // Commit new nodes + edges to graph (staggered so you see them pop in)
                    for (let i = 0; i < newNodes.length; i++) {
                        const n = newNodes[i];
                        await new Promise(r => setTimeout(r, 250));
                        setGraphData(prev => ({ nodes: [...prev.nodes, n], links: prev.links }));
                        persistNode(n); // autosave to InsForge
                    }
                    await new Promise(r => setTimeout(r, 150));
                    setGraphData(prev => ({ nodes: prev.nodes, links: [...prev.links, ...newLinks] }));
                    for (const e of newLinks) persistEdge(e); // autosave edges
                    // Zoom out so new nodes are visible
                    setTimeout(() => setZoomToFitTrigger(t => t + 1), 400);

                    // Clear isNew flag after flash
                    setTimeout(() => {
                        setGraphData(prev => {
                            if (!prev) return prev;
                            for (const n of prev.nodes) { if (n.id.startsWith('concept_q_')) n.isNew = false; }
                            return { nodes: [...prev.nodes], links: prev.links };
                        });
                    }, 2500);

                    // Pick the two new concepts as anchors
                    let nodeA = newNodes[0];
                    let nodeB = newNodes[1];

                    // Build a temporary adjacency that includes the new edges (state hasn't propagated yet)
                    const tempAdj = { ...adjacency };
                    for (const l of newLinks) {
                        if (!tempAdj[l.source]) tempAdj[l.source] = [];
                        if (!tempAdj[l.target]) tempAdj[l.target] = [];
                        tempAdj[l.source].push(l.target);
                        tempAdj[l.target].push(l.source);
                    }

                    // Local BFS over the combined graph
                    const localBfs = (start, end) => {
                        if (start === end) return [start];
                        const visited = new Set([start]);
                        const queue = [[start]];
                        while (queue.length) {
                            const p = queue.shift();
                            const cur = p[p.length - 1];
                            for (const nb of (tempAdj[cur] || [])) {
                                if (nb === end) return [...p, nb];
                                if (!visited.has(nb)) { visited.add(nb); if (p.length < 10) queue.push([...p, nb]); }
                            }
                        }
                        return null;
                    };

                    const found = localBfs(nodeA.id, nodeB.id);
                    if (found && found.length >= 2 && found.length <= 7) {
                        pathIds = found;
                    } else {
                        // Still disconnected — create a direct edge between the two new concepts
                        const directEdge = {
                            id: `link_q_direct_${Date.now()}`,
                            source: nodeA.id, target: nodeB.id, type: 'relates_to',
                            strength: 0.5, relationship: 'contrasted in question',
                        };
                        setGraphData(prev => ({ nodes: prev.nodes, links: [...prev.links, directEdge] }));
                        persistEdge(directEdge);
                        pathIds = [nodeA.id, nodeB.id];
                    }
                    // Fall through to the shared walker animation + LLM explanation below
                }

                if (!pathIds && matches.length >= 2) {
                    // Prefer non-Source matches as anchors when possible: Sources are
                    // documents, not conceptual anchors. "jason mars" should pair with
                    // the Person "Barack Obama" rather than a Source note.
                    const nonSource = matches.filter(m => m.type !== 'Source');
                    const pool = nonSource.length >= 2 ? nonSource : matches;
                    let nodeA = pool[0];
                    let nodeB = pool[1];
                    // If the user explicitly named BOTH top matches in the question,
                    // respect that — don't hijack matches[1] to chase domain diversity.
                    // A name is "in the question" if ANY word ≥4 chars of the node name
                    // appears in the question (so "obama" matches "Barack Obama").
                    const qLowerForCheck = question.toLowerCase();
                    const nameInQ = (n) => {
                        if (!n || !(n.name || '').length) return false;
                        const words = (n.name || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
                        return words.some(w => qLowerForCheck.includes(w));
                    };
                    const bothNamed = nameInQ(pool[0]) && nameInQ(pool[1]);
                    if (!bothNamed) {
                        // Only do the domain-diversity swap when pool[1] isn't already
                        // an explicit named anchor in the question.
                        for (let i = 1; i < pool.length; i++) {
                            if (pool[i].domain !== nodeA.domain) {
                                nodeB = pool[i];
                                break;
                            }
                        }
                    }
                    const found = bfsPath(nodeA.id, nodeB.id);
                    if (found && found.length >= 2 && found.length <= 6) {
                        pathIds = found;
                    } else {
                        // No short path exists — ask LLM to explain the connection
                        // and create a new edge so the graph learns
                        try {
                            const resp = await fetch('http://localhost:3001/api/ask', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    question,
                                    path_nodes: [
                                        { name: nodeA.name, description: nodeA.description || '' },
                                        { name: nodeB.name, description: nodeB.description || '' },
                                    ],
                                }),
                            });
                            const data = await resp.json();
                            answerText = data.answer || '';
                        } catch (e) { /* LLM unavailable, proceed with path */ }

                        // Create a new edge between them so the graph grows
                        const newEdge = {
                            id: `link_discovered_${Date.now()}`,
                            source: nodeA.id,
                            target: nodeB.id,
                            type: 'relates_to',
                            strength: 0.5,
                            relationship: answerText ? answerText.slice(0, 100) : 'discovered connection',
                        };
                        setGraphData(prev => ({
                            nodes: prev.nodes,
                            links: [...prev.links, newEdge],
                        }));
                        persistEdge(newEdge);

                        pathIds = [nodeA.id, nodeB.id];
                    }
                } else if (!pathIds && matches.length === 1) {
                    pathIds = [matches[0].id, ...(adjacency[matches[0].id] || []).slice(0, 3)];
                }
                if (!answerText) answerText = null;
            }

            if (pathIds.length === 0) {
                setAnswer({ loading: false, question, text: "I couldn't find a connection for that in your notes yet.", path: [] });
                setActiveWalker(null);
                return;
            }

            // Step 2: Animate walker along the path FIRST
            const pathNames = pathIds.map(id => nodeById[id]?.name || id);
            setWalkerTrail({ walkerType: 'pathfinder', nodeIds: pathIds, currentStep: 0, speed: 500 });
            for (let i = 0; i < pathIds.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                setWalkerTrail(prev => prev ? { ...prev, currentStep: i } : null);
            }
            await new Promise(resolve => setTimeout(resolve, 300));

            // Step 3: REINFORCE edges along the path (spaced repetition + associative activation)
            reinforcePath(pathIds);

            // Show path found
            setAnswer({ loading: false, question, text: `Path found: ${pathNames.join(' → ')}. Generating insight...`, path: pathNames });

            // Step 4: NOW call LLM to explain the path (if not pre-built insight)
            if (!answerText) {
                const pathContext = pathIds.map(id => {
                    const n = nodeById[id];
                    return n ? { name: n.name, description: n.description || '' } : { name: id, description: '' };
                });
                try {
                    const resp = await fetch('http://localhost:3001/api/ask', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question, path_nodes: pathContext }),
                    });
                    const data = await resp.json();
                    answerText = data.answer || `${pathNames.join(' → ')}`;
                } catch (e) {
                    answerText = `${pathNames.join(' → ')}. (Start the API server for AI explanations)`;
                }
            }

            // Step 5: Update with final answer
            setAnswer({ loading: false, question, text: answerText, path: pathNames });
            // Persist as insight (skip if LLM failed and we only have a path string)
            if (answerText && !answerText.includes('Start the API server')) {
                addInsight(question, answerText, pathIds, 'pathfinder');
            }
            // Keep the trail visible - don't auto-fade
            // User can clear it by asking a new question
        } catch (err) {
            console.error('Pathfinder error:', err);
            setAnswer({
                loading: false,
                question,
                text: 'An error occurred while traversing the knowledge graph.',
                path: [],
            });
        } finally {
            setActiveWalker(null);
        }
    }, [graphData, findMatchingNodes, bfsPath, adjacency, nodeById, addInsight, reinforcePath]);

    /**
     * Handle knowledge ingestion by triggering the Ingestor walker.
     */
    const handleIngest = useCallback(async (text, sourceType, url) => {
        setIsIngesting(true);
        setActiveWalker('ingestor');

        try {
            // === TRY LIVE JAC INGESTOR FIRST ===
            if (jacAvailable) {
                try {
                    const walkerResult = await jacIngest(text, sourceType, url);
                    if (walkerResult) {
                        const newConcepts = walkerResult.new_concepts || [];
                        const traversalPath = walkerResult.traversal_path || [];
                        console.log(`[ORBIT] Ingested via Jac: ${newConcepts.length} concepts, ${walkerResult.new_edges_count || 0} edges`);

                        // Refresh the graph data from backend
                        const freshGraph = await jacGetGraph();
                        if (freshGraph?.nodes) {
                            const nodes = freshGraph.nodes.map(n => ({
                                id: n.id, name: n.name || n.title || n.text || 'Untitled',
                                type: n.type || 'Concept', description: n.description || '',
                                domain: n.domain || 'general', importance: n.importance || 0.5,
                                depth: n.depth || 'surface', ...n,
                            }));
                            const links = (freshGraph.edges || []).map((e, i) => ({
                                id: e.id || `edge_${i}`, source: e.source, target: e.target,
                                type: e.type || 'relates_to', strength: e.strength || 0.5,
                                relationship: e.relationship || '', ...e,
                            }));
                            setGraphData({ nodes, links });
                            setTimeout(() => setZoomToFitTrigger(t => t + 1), 500);
                        }

                        setIsIngesting(false);
                        setActiveWalker(null);
                        return;
                    }
                } catch (e) {
                    console.log('[ORBIT] Jac Ingestor failed, falling back:', e.message);
                }
            }

            // === FALLBACK: Client-side mock ingestion ===
            const timestamp = Date.now() / 1000;
            const sourceId = `source_${Date.now()}`;
            const sourceNode = {
                id: sourceId,
                name: `${sourceType}: ${text.slice(0, 40)}...`,
                type: 'Source',
                description: text,
                sourceType,
                url: url || '',
                createdAt: timestamp,
                importance: 0.3,
                isNew: true,
            };

            // Extract concepts using LLM (falls back to word extraction if API unavailable)
            let extractedConcepts = [];
            try {
                const resp = await fetch('http://localhost:3001/api/ingest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, source_type: sourceType }),
                });
                const data = await resp.json();
                extractedConcepts = data.concepts || [];
            } catch (e) {
                // Fallback: extract long words as concept names
                const words = text.split(/\s+/).filter(w => w.length > 5);
                extractedConcepts = words.slice(0, 3).map(w => ({ name: w, description: `From ${sourceType}` }));
            }

            const newConcepts = [];
            const newLinks = [];
            // Dedup against ALL searchable node types (not just Concepts) so that
            // "Jason Mars" ingested twice doesn't create two nodes, and so that a
            // Person ingested later matches an existing Person/Concept.
            const dedupPool = (graphData?.nodes || []).filter(n =>
                n.type === 'Concept' || n.type === 'Person' || n.type === 'Project' || n.type === 'Source'
            );
            const existingConcepts = dedupPool.filter(n => n.type === 'Concept');

            for (let i = 0; i < extractedConcepts.length; i++) {
                const extractedName = (extractedConcepts[i].name || '').toLowerCase().trim();
                const extractedType = extractedConcepts[i].type || 'Concept';

                // Check if this entity already exists (by name, any type)
                const existingMatch = dedupPool.find(n => {
                    const existName = (n.name || '').toLowerCase().trim();
                    return existName === extractedName;
                });

                if (existingMatch) {
                    // Don't create duplicate - link source to existing node
                    newLinks.push({
                        id: `link_${Date.now()}_existing_${i}`,
                        source: existingMatch.id,
                        target: sourceId,
                        type: 'sourced_from',
                        strength: 0.85,
                        relationship: 'referenced in new source',
                    });
                    // Boost the existing node's importance
                    newConcepts.push({ ...existingMatch, isNew: true, importance: Math.min(1, (existingMatch.importance || 0.5) + 0.1) });
                } else {
                    // Create new node with LLM-detected type
                    const nodeId = `${extractedType.toLowerCase()}_${Date.now()}_${i}`;
                    newConcepts.push({
                        id: nodeId,
                        name: extractedConcepts[i].name || `Entity ${i + 1}`,
                        type: extractedType,
                        description: extractedConcepts[i].description || '',
                        domain: extractedConcepts[i].domain || 'general',
                        importance: 0.4,
                        depth: 'surface',
                        createdAt: timestamp,
                        lastAccessed: timestamp,
                        accessCount: 1,
                        isNew: true,
                    });

                    // Edge type depends on entity type: Concepts use sourced_from,
                    // People use mentioned_by, Projects use applied_in.
                    const edgeType = extractedType === 'Person' ? 'mentioned_by'
                        : extractedType === 'Project' ? 'applied_in'
                        : 'sourced_from';
                    newLinks.push({
                        id: `link_${Date.now()}_${i}`,
                        source: nodeId,
                        target: sourceId,
                        type: edgeType,
                        strength: 0.8,
                        relationship: `extracted from ${sourceType}`,
                    });
                }
            }

            // Use LLM to find meaningful connections to existing nodes
            // "genuinely new" = nodes we just created (not existing ones we matched)
            const existingIds = new Set(dedupPool.map(n => n.id));
            const genuinelyNew = newConcepts.filter(n => !existingIds.has(n.id));

            // Fuzzy match helper: finds best existing node for a name
            const fuzzyFind = (name, pool) => {
                const q = (name || '').toLowerCase().replace(/[_-]/g, ' ');
                // Exact match
                let found = pool.find(n => (n.name || '').toLowerCase() === q);
                if (found) return found;
                // Substring match
                found = pool.find(n => (n.name || '').toLowerCase().includes(q) || q.includes((n.name || '').toLowerCase()));
                if (found) return found;
                // Word overlap
                const qWords = q.split(/\s+/).filter(w => w.length > 2);
                let best = null, bestScore = 0;
                for (const n of pool) {
                    const nWords = (n.name || '').toLowerCase().split(/\s+/);
                    const score = qWords.filter(w => nWords.some(nw => nw.includes(w) || w.includes(nw))).length;
                    if (score > bestScore) { bestScore = score; best = n; }
                }
                return bestScore > 0 ? best : null;
            };

            if (genuinelyNew.length > 0) {
                try {
                    const connectResp = await fetch('http://localhost:3001/api/connect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            new_concepts: genuinelyNew.map(c => ({ name: c.name, description: c.description })),
                            existing_nodes: existingConcepts.map(c => ({ name: c.name, id: c.id })),
                        }),
                    });
                    const connectData = await connectResp.json();
                    const connectedSources = new Set();
                    for (const conn of (connectData.connections || [])) {
                        const srcNode = fuzzyFind(conn.source, genuinelyNew);
                        const tgtNode = fuzzyFind(conn.target, existingConcepts);
                        if (srcNode && tgtNode) {
                            newLinks.push({
                                id: `link_${Date.now()}_llm_${srcNode.id}_${tgtNode.id}`,
                                source: srcNode.id,
                                target: tgtNode.id,
                                type: 'relates_to',
                                strength: 0.6,
                                relationship: conn.relationship || 'related concept',
                            });
                            connectedSources.add(srcNode.id);
                        }
                    }
                    // Ensure every new concept gets 2-3 connections
                    for (const nc of genuinelyNew) {
                        if (!connectedSources.has(nc.id)) {
                            // Score existing concepts by description word overlap
                            const ncWords = new Set(
                                (nc.name + ' ' + (nc.description || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3)
                            );
                            const scored = existingConcepts.map(ex => {
                                const exWords = (ex.name + ' ' + (ex.description || '')).toLowerCase().split(/\s+/);
                                const hits = exWords.filter(w => ncWords.has(w)).length;
                                return { ex, score: hits };
                            }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

                            // Connect to top 2 matches, or pick 2 random if nothing scored
                            const picks = scored.length > 0
                                ? scored.slice(0, 2).map(s => s.ex)
                                : existingConcepts.slice(0, 2);
                            for (const match of picks) {
                                newLinks.push({
                                    id: `link_${Date.now()}_ensure_${nc.id}_${match.id}`,
                                    source: nc.id, target: match.id,
                                    type: 'relates_to',
                                    strength: scored.length > 0 ? 0.5 : 0.3,
                                    relationship: scored.length > 0 ? 'semantically related' : 'bridging concept',
                                });
                            }
                        }
                    }
                } catch (e) {
                    // Fallback: connect each new concept to best word-overlap match
                    for (const nc of genuinelyNew) {
                        const match = fuzzyFind(nc.name, existingConcepts);
                        if (match) {
                            newLinks.push({
                                id: `link_${Date.now()}_fb_${nc.id}`,
                                source: nc.id, target: match.id,
                                type: 'relates_to', strength: 0.4,
                                relationship: 'potentially related',
                            });
                        }
                    }
                }
            }

            // Animate ingestor trail
            const trailSteps = [sourceId, ...newConcepts.map(c => c.id)];
            setWalkerTrail({
                walkerType: 'ingestor',
                nodeIds: trailSteps,
                currentStep: 0,
                speed: 300,
            });

            // Staggered node appearance - add new nodes, update existing ones
            const allNewNodes = [sourceNode, ...genuinelyNew];
            const updatedExisting = newConcepts.filter(n => existingIds.has(n.id));

            // First update existing nodes (flash them) — mutate in place to keep link refs
            if (updatedExisting.length > 0) {
                for (const u of updatedExisting) {
                    const target = graphData?.nodes?.find(n => n.id === u.id);
                    if (target) {
                        target.isNew = true;
                        target.importance = u.importance;
                    }
                }
                setGraphData(prev => ({ nodes: [...prev.nodes], links: prev.links }));
            }

            // Then add genuinely new nodes with stagger
            for (let i = 0; i < allNewNodes.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 300));
                setGraphData(prev => ({
                    nodes: [...prev.nodes, allNewNodes[i]],
                    links: prev.links,
                }));
                persistNode(allNewNodes[i]); // autosave to InsForge
                setWalkerTrail(prev => prev ? { ...prev, currentStep: i } : null);
            }

            // Add all links
            await new Promise(resolve => setTimeout(resolve, 200));
            setGraphData(prev => ({
                nodes: prev.nodes,
                links: [...prev.links, ...newLinks],
            }));
            for (const e of newLinks) persistEdge(e); // autosave edges

            // Zoom to fit so new nodes are visible
            setTimeout(() => setZoomToFitTrigger(t => t + 1), 500);
            setTimeout(() => setZoomToFitTrigger(t => t + 1), 2000);

            // Clear isNew flag after flash — mutate in place to keep link refs
            setTimeout(() => {
                setGraphData(prev => {
                    if (!prev) return prev;
                    for (const n of prev.nodes) { if (n.isNew) n.isNew = false; }
                    return { nodes: [...prev.nodes], links: prev.links };
                });
            }, 2000);
        } catch (err) {
            console.error('Ingest error:', err);
        } finally {
            setIsIngesting(false);
            setActiveWalker(null);
        }
    }, [graphData]);

    /**
     * "Surprise Me" — pick two random distant nodes, BFS directly (no text matching),
     * animate the path, then call LLM to explain.
     */
    const handleSurprise = useCallback(async () => {
        const concepts = (graphData?.nodes || []).filter(n => n.type === 'Concept');
        if (concepts.length < 10) return;

        // Find two nodes from different domains with a 3-6 hop path
        let pathIds = null;
        let nodeA = null, nodeB = null;
        for (let attempt = 0; attempt < 30; attempt++) {
            const a = concepts[Math.floor(Math.random() * concepts.length)];
            const b = concepts[Math.floor(Math.random() * concepts.length)];
            if (a.id === b.id || a.domain === b.domain) continue;

            const path = bfsPath(a.id, b.id);
            // Verify path actually starts at a and ends at b
            if (path && path.length >= 3 && path.length <= 6
                && path[0] === a.id && path[path.length - 1] === b.id) {
                pathIds = path;
                nodeA = a;
                nodeB = b;
                break;
            }
        }

        if (!pathIds || !nodeA || !nodeB) return;

        const question = `How does ${nodeA.name} connect to ${nodeB.name}?`;
        setAnswer({ loading: true, question, text: '' });
        setActiveWalker('pathfinder');

        // Animate walker along the KNOWN path
        setWalkerTrail({ walkerType: 'pathfinder', nodeIds: pathIds, currentStep: 0, speed: 500 });
        for (let i = 0; i < pathIds.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            setWalkerTrail(prev => prev ? { ...prev, currentStep: i } : null);
        }
        await new Promise(resolve => setTimeout(resolve, 300));

        // Show path found & reinforce traversed edges
        const pathNames = pathIds.map(id => nodeById[id]?.name || id);
        reinforcePath(pathIds);
        setAnswer({ loading: false, question, text: `Path found: ${pathNames.join(' → ')}. Generating insight...`, path: pathNames });

        // Call LLM with the actual path
        const pathContext = pathIds.map(id => {
            const n = nodeById[id];
            return n ? { name: n.name, description: n.description || '' } : { name: id, description: '' };
        });
        try {
            const resp = await fetch('http://localhost:3001/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, path_nodes: pathContext }),
            });
            const data = await resp.json();
            const finalText = data.answer || pathNames.join(' → ');
            setAnswer({ loading: false, question, text: finalText, path: pathNames });
            if (data.answer) addInsight(question, finalText, pathIds, 'surprise');
        } catch (e) {
            setAnswer({ loading: false, question, text: `${pathNames.join(' → ')}`, path: pathNames });
        }
        setActiveWalker(null);
    }, [graphData, bfsPath, nodeById, addInsight, reinforcePath]);

    /**
     * Handle clicking a node in the graph view.
     */
    const handleNodeClick = useCallback((node) => {
        setSelectedNode(node);
        setRightPanelCollapsed(false);

        // Mutate in place to avoid breaking force simulation link refs
        node.accessCount = (node.accessCount || 0) + 1;
        node.lastAccessed = Date.now() / 1000;
    }, []);

    /**
     * Highlight a path on the graph (from insight or answer).
     */
    const handleViewPath = useCallback((path) => {
        if (!path || path.length === 0) return;
        setWalkerTrail({
            walkerType: 'explorer',
            nodeIds: path,
            currentStep: path.length - 1,
            speed: 600,
        });
    }, []);

    return (
        <div className="orbit-app night-mode">
            {/* Header */}
            <header className="orbit-header">
                <div className="orbit-logo">
                    <span className="orbit-logo-icon">&#9673;</span>
                    <span className="orbit-logo-text">ORBIT</span>
                    <span className="orbit-tagline">See how everything you know connects</span>
                </div>

                <QueryBar
                    onQuery={handleQuery}
                    isLoading={activeWalker === 'pathfinder'}
                />

                <div className="header-controls">
                    <button
                        className="surprise-btn"
                        onClick={handleSurprise}
                        disabled={activeWalker === 'pathfinder'}
                        title="Find a surprise connection between distant concepts"
                    >
                        &#10024; Surprise Me
                    </button>
                </div>
            </header>

            {/* Main content */}
            <main className="orbit-main">
                {/* Left sidebar: Ingest Panel */}
                {leftPanelCollapsed ? (
                    <button
                        className="sidebar-tab left"
                        onClick={() => setLeftPanelCollapsed(false)}
                        title="Expand panel"
                    >
                        {'\u25B6'}
                    </button>
                ) : (
                    <aside className="orbit-sidebar left">
                        <button
                            className="sidebar-toggle left"
                            onClick={() => setLeftPanelCollapsed(true)}
                            title="Collapse panel"
                        >
                            {'\u25C0'}
                        </button>
                        <IngestPanel
                            onIngest={handleIngest}
                            isIngesting={isIngesting}
                        />
                    </aside>
                )}

                {/* Center: Graph View */}
                <section className="orbit-graph-container">
                    {graphData && graphData.nodes.length > 0 ? (
                        <GraphView
                            data={graphData}
                            onNodeClick={handleNodeClick}
                            selectedNode={selectedNode}
                            walkerTrail={walkerTrail ? walkerTrail.nodeIds : null}
                            walkerType={walkerTrail ? walkerTrail.walkerType : null}
                            isDarkMode={isDarkMode}
                            zoomToFitTrigger={zoomToFitTrigger}
                        />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#555577', fontSize: 14 }}>
                            Loading knowledge graph...
                        </div>
                    )}
                    {walkerTrail && (
                        <WalkerTrail
                            trail={walkerTrail}
                            graphData={graphData}
                        />
                    )}

                    {/* Active walker indicator */}
                    {activeWalker && (
                        <div className={`walker-indicator walker-${activeWalker}`}>
                            <span className="walker-indicator-dot"></span>
                            <span className="walker-indicator-label">
                                {activeWalker.charAt(0).toUpperCase() + activeWalker.slice(1)} walking...
                            </span>
                        </div>
                    )}
                </section>

                {/* Right sidebar: Node Detail or Insight Feed */}
                {rightPanelCollapsed ? (
                    <button
                        className="sidebar-tab right"
                        onClick={() => setRightPanelCollapsed(false)}
                        title="Expand panel"
                    >
                        {'\u25C0'}
                    </button>
                ) : (
                    <aside className="orbit-sidebar right">
                        <button
                            className="sidebar-toggle right"
                            onClick={() => setRightPanelCollapsed(true)}
                            title="Collapse panel"
                        >
                            {'\u25B6'}
                        </button>
                        {selectedNode ? (
                            <NodeDetail
                                node={selectedNode}
                                onClose={() => setSelectedNode(null)}
                                graphData={graphData}
                            />
                        ) : (
                            <InsightFeed
                                insights={insights}
                                answer={answer}
                                onViewPath={handleViewPath}
                                graphData={graphData}
                            />
                        )}
                    </aside>
                )}
            </main>

            {/* Footer stats bar */}
            <footer className="orbit-footer">
                <div className="orbit-stats">
                    <span className="stat-item">
                        <span className="stat-count">{stats.concepts}</span> concepts
                    </span>
                    <span className="stat-dot">&middot;</span>
                    <span className="stat-item">
                        <span className="stat-count">{stats.connections}</span> connections
                    </span>
                    <span className="stat-dot">&middot;</span>
                    <span className="stat-item">
                        <span className="stat-count">{stats.insights}</span> insights
                    </span>
                    <span className="stat-dot">&middot;</span>
                    <span className="stat-item">
                        <span className="stat-count">{stats.sources}</span> sources
                    </span>
                    {stats.people > 0 && (
                        <>
                            <span className="stat-dot">&middot;</span>
                            <span className="stat-item">
                                <span className="stat-count">{stats.people}</span> people
                            </span>
                        </>
                    )}
                </div>
                <div className="orbit-footer-brand">
                    ORBIT v0.1 &middot; Built with Jac {jacAvailable ? '(live walkers)' : '(demo mode)'} &middot;{' '}
                    <span
                        title={`InsForge ${insforgeStatus} (user ${userIdRef.current || '...'})`}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            color: insforgeStatus === 'synced' ? '#44DDAA'
                                : insforgeStatus === 'syncing' ? '#FFD700'
                                : insforgeStatus === 'error' ? '#FF4466'
                                : 'inherit',
                        }}
                    >
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: 'currentColor',
                            boxShadow: insforgeStatus === 'synced' ? '0 0 6px currentColor' : 'none',
                            animation: insforgeStatus === 'syncing' ? 'pulse 1s ease-in-out infinite' : 'none',
                        }} />
                        InsForge {insforgeStatus === 'synced' ? 'synced' : insforgeStatus === 'syncing' ? 'syncing' : insforgeStatus === 'error' ? 'offline' : 'ready'}
                    </span>
                    {realtimeStatus === 'live' && (
                        <span style={{
                            marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                            color: recentRealtimeEvent && (Date.now() - recentRealtimeEvent.at < 2000) ? '#FFD700' : '#AA66FF',
                        }}
                        title="Realtime sync active — changes broadcast across tabs"
                        >
                            <span style={{
                                width: 6, height: 6, borderRadius: '50%', background: 'currentColor',
                                boxShadow: '0 0 6px currentColor',
                                animation: recentRealtimeEvent && (Date.now() - recentRealtimeEvent.at < 2000) ? 'pulse 0.6s ease-in-out infinite' : 'none',
                            }} />
                            live
                        </span>
                    )}
                </div>
            </footer>
        </div>
    );
}
