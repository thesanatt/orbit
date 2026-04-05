/**
 * InsForge client for ORBIT
 * Handles persistent storage of knowledge graph in InsForge Postgres
 * PLUS realtime pub/sub for cross-tab / multi-user graph sync.
 */

import { createClient } from '@insforge/sdk';

const INSFORGE_URL = 'https://6464zdsg.us-east.insforge.app';
const INSFORGE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQ5MjJ9.QC8h_mrlE5W30Ixntcrx9LJccfIWBQNB95xMnK5n4jM';

// Singleton SDK client for realtime pub/sub (separate from REST helpers)
let _sdkClient = null;
function getSDK() {
    if (_sdkClient) return _sdkClient;
    try {
        _sdkClient = createClient({
            baseUrl: INSFORGE_URL,
            anonKey: INSFORGE_KEY,
        });
    } catch (e) {
        console.warn('[InsForge] SDK init failed:', e.message);
    }
    return _sdkClient;
}

const headers = (token) => ({
    'Authorization': `Bearer ${token || INSFORGE_KEY}`,
    'Content-Type': 'application/json',
});

/**
 * Load all nodes and edges from InsForge for a given user
 */
export async function loadGraph(userId = 'demo') {
    try {
        const [nodesRes, edgesRes] = await Promise.all([
            fetch(`${INSFORGE_URL}/api/database/records/knowledge_nodes?user_id=eq.${userId}&limit=1000`, {
                headers: headers(),
            }),
            fetch(`${INSFORGE_URL}/api/database/records/knowledge_edges?user_id=eq.${userId}&limit=5000`, {
                headers: headers(),
            }),
        ]);

        const nodes = await nodesRes.json();
        const edges = await edgesRes.json();

        // Transform to frontend format
        const formattedNodes = nodes.map(n => ({
            id: n.id,
            name: n.name,
            type: n.type,
            description: n.description || '',
            domain: n.domain || 'general',
            importance: n.importance || 0.5,
            depth: n.depth || 'surface',
            ...(n.data && typeof n.data === 'object' ? n.data : {}),
        }));

        const formattedEdges = edges.map(e => ({
            id: e.id,
            source: e.source_id,
            target: e.target_id,
            type: e.type || 'relates_to',
            strength: e.strength || 0.5,
            relationship: e.relationship || '',
        }));

        return { nodes: formattedNodes, links: formattedEdges };
    } catch (err) {
        console.error('InsForge load failed:', err);
        return null;
    }
}

/**
 * Save a new node to InsForge
 */
export async function saveNode(node, userId = 'demo') {
    try {
        const res = await fetch(`${INSFORGE_URL}/api/database/records/knowledge_nodes`, {
            method: 'POST',
            headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify([{
                id: node.id,
                user_id: userId,
                type: node.type || 'Concept',
                name: node.name || '',
                description: node.description || '',
                domain: node.domain || 'general',
                importance: node.importance || 0.5,
                depth: node.depth || 'surface',
            }]),
        });
        return await res.json();
    } catch (err) {
        console.error('InsForge save node failed:', err);
        return null;
    }
}

/**
 * Save a new edge to InsForge
 */
export async function saveEdge(edge, userId = 'demo') {
    try {
        const res = await fetch(`${INSFORGE_URL}/api/database/records/knowledge_edges`, {
            method: 'POST',
            headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify([{
                id: edge.id,
                user_id: userId,
                source_id: typeof edge.source === 'object' ? edge.source.id : edge.source,
                target_id: typeof edge.target === 'object' ? edge.target.id : edge.target,
                type: edge.type || 'relates_to',
                strength: edge.strength || 0.5,
                relationship: edge.relationship || '',
            }]),
        });
        return await res.json();
    } catch (err) {
        console.error('InsForge save edge failed:', err);
        return null;
    }
}

/**
 * Update edge strength (for spaced repetition reinforcement)
 */
export async function updateEdgeStrength(edgeId, newStrength) {
    try {
        await fetch(`${INSFORGE_URL}/api/database/records/knowledge_edges?id=eq.${edgeId}`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ strength: newStrength }),
        });
    } catch (err) {
        console.error('InsForge update edge failed:', err);
    }
}

/**
 * Register a new user
 */
export async function registerUser(email, password, name) {
    try {
        const res = await fetch(`${INSFORGE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name }),
        });
        return await res.json();
    } catch (err) {
        console.error('InsForge register failed:', err);
        return { error: err.message };
    }
}

/**
 * Login user
 */
export async function loginUser(email, password) {
    try {
        const res = await fetch(`${INSFORGE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        return await res.json();
    } catch (err) {
        console.error('InsForge login failed:', err);
        return { error: err.message };
    }
}

/**
 * Merge two users' knowledge graphs (Merge Minds)
 * Copies all nodes/edges from otherUserId into currentUserId
 */
export async function mergeGraphs(currentUserId, otherUserId) {
    try {
        // Load other user's graph
        const otherGraph = await loadGraph(otherUserId);
        if (!otherGraph) return { error: 'Could not load other graph' };

        // Save each node/edge with currentUserId (upsert to avoid duplicates)
        const nodePromises = otherGraph.nodes.map(n =>
            saveNode({ ...n, id: `${otherUserId}_${n.id}` }, currentUserId)
        );
        const edgePromises = otherGraph.links.map(e =>
            saveEdge({
                ...e,
                id: `${otherUserId}_${e.id}`,
                source: `${otherUserId}_${e.source}`,
                target: `${otherUserId}_${e.target}`,
            }, currentUserId)
        );

        await Promise.all([...nodePromises, ...edgePromises]);
        return { merged: otherGraph.nodes.length, edges: otherGraph.links.length };
    } catch (err) {
        console.error('Merge failed:', err);
        return { error: err.message };
    }
}

/**
 * Batch sync graph data to InsForge (fire-and-forget).
 * Called after loading the graph to ensure InsForge has the latest state.
 */
export async function syncGraphToInsForge(nodes, edges, userId = 'demo') {
    try {
        // Batch save nodes (upsert)
        const nodeRecords = nodes.slice(0, 500).map(n => ({
            id: n.id,
            user_id: userId,
            type: n.type || 'Concept',
            name: n.name || '',
            description: (n.description || '').slice(0, 500),
            domain: n.domain || 'general',
            importance: n.importance || 0.5,
            depth: n.depth || 'surface',
        }));

        const edgeRecords = edges.slice(0, 1000).map(e => ({
            id: e.id || `${e.source}_${e.target}`,
            user_id: userId,
            source_id: typeof e.source === 'object' ? e.source.id : e.source,
            target_id: typeof e.target === 'object' ? e.target.id : e.target,
            type: e.type || 'relates_to',
            strength: e.strength || 0.5,
            relationship: e.relationship || '',
        }));

        // Batch POST in chunks
        const CHUNK = 50;
        for (let i = 0; i < nodeRecords.length; i += CHUNK) {
            await fetch(`${INSFORGE_URL}/api/database/records/knowledge_nodes`, {
                method: 'POST',
                headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify(nodeRecords.slice(i, i + CHUNK)),
            }).catch(() => {});
        }
        for (let i = 0; i < edgeRecords.length; i += CHUNK) {
            await fetch(`${INSFORGE_URL}/api/database/records/knowledge_edges`, {
                method: 'POST',
                headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify(edgeRecords.slice(i, i + CHUNK)),
            }).catch(() => {});
        }

        console.log(`[InsForge] Synced ${nodeRecords.length} nodes, ${edgeRecords.length} edges`);
        return true;
    } catch (err) {
        console.warn('[InsForge] Sync failed:', err.message);
        return false;
    }
}

export const INSFORGE_CONFIG = { url: INSFORGE_URL, key: INSFORGE_KEY };

/**
 * Stable userId per browser (persists across reloads via localStorage).
 * Prefix "orbit_" so InsForge records are clearly identified.
 */
export function getUserId() {
    try {
        let id = localStorage.getItem('orbit_user_id');
        if (!id) {
            id = 'orbit_' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('orbit_user_id', id);
        }
        return id;
    } catch { return 'orbit_anon'; }
}

/**
 * Delete all records for a user (nodes + edges) — use before a bulk reseed
 * to avoid stale references.
 */
export async function wipeUserData(userId) {
    try {
        await Promise.all([
            fetch(`${INSFORGE_URL}/api/database/records/knowledge_nodes?user_id=eq.${userId}`, {
                method: 'DELETE', headers: headers(),
            }),
            fetch(`${INSFORGE_URL}/api/database/records/knowledge_edges?user_id=eq.${userId}`, {
                method: 'DELETE', headers: headers(),
            }),
        ]);
        return true;
    } catch (e) { return false; }
}

/**
 * Subscribe to realtime updates on a user's graph channel.
 * onEvent(type, payload) fires for every remote update (not self-generated).
 * Returns a cleanup function.
 */
export async function subscribeToRealtimeUpdates(userId, onEvent) {
    const sdk = getSDK();
    if (!sdk || !sdk.realtime) {
        console.warn('[InsForge Realtime] SDK not available');
        return () => {};
    }
    const channel = `orbit:${userId}`;
    const ownSocketId = { current: null };

    try {
        await sdk.realtime.connect();
        ownSocketId.current = sdk.realtime.socketId;
        const { ok, error } = await sdk.realtime.subscribe(channel);
        if (!ok) {
            console.warn('[InsForge Realtime] subscribe failed:', error?.message);
            return () => {};
        }
        console.log(`[InsForge Realtime] Subscribed to ${channel} (socket ${ownSocketId.current})`);
    } catch (e) {
        console.warn('[InsForge Realtime] connect failed:', e.message);
        return () => {};
    }

    const eventTypes = ['orbit_node_added', 'orbit_edge_added', 'orbit_insight_added'];
    const handlers = {};
    for (const evt of eventTypes) {
        handlers[evt] = (payload) => {
            // Ignore echoes: we embed our socket ID in published messages
            if (payload?._from && payload._from === ownSocketId.current) return;
            try { onEvent(evt, payload); } catch (e) { /* user handler crashed */ }
        };
        sdk.realtime.on(evt, handlers[evt]);
    }

    // Return cleanup
    return () => {
        try {
            for (const evt of eventTypes) sdk.realtime.off(evt, handlers[evt]);
            sdk.realtime.unsubscribe(channel);
        } catch { /* noop */ }
    };
}

/**
 * Publish a realtime update to the user's graph channel. Fire-and-forget.
 */
export async function publishRealtimeUpdate(userId, eventType, payload) {
    const sdk = getSDK();
    if (!sdk || !sdk.realtime) return;
    try {
        // Ensure we're connected + subscribed (idempotent)
        if (!sdk.realtime.isConnected) await sdk.realtime.connect();
        const channel = `orbit:${userId}`;
        const subs = sdk.realtime.getSubscribedChannels?.() || [];
        if (!subs.includes(channel)) {
            await sdk.realtime.subscribe(channel);
        }
        // Embed our socket ID so subscribers can ignore echoes of their own messages
        await sdk.realtime.publish(channel, eventType, {
            ...payload,
            _from: sdk.realtime.socketId,
        });
    } catch (e) {
        // Silent failure — realtime is nice-to-have, not critical
    }
}

/**
 * Save an insight node to InsForge (stored in knowledge_nodes with type='Insight').
 */
export async function saveInsight(insight, userId) {
    try {
        const res = await fetch(`${INSFORGE_URL}/api/database/records/knowledge_nodes`, {
            method: 'POST',
            headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify([{
                id: insight.id,
                user_id: userId,
                type: 'Insight',
                name: (insight.title || '').slice(0, 200),
                description: (insight.description || '').slice(0, 1000),
                domain: 'discovery',
                importance: insight.confidence || 0.8,
                depth: 'deep',
            }]),
        });
        return res.ok;
    } catch { return false; }
}
