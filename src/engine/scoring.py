"""ORBIT — Node & Edge Scoring Engine"""

import math
from collections import defaultdict
from typing import Dict, FrozenSet, List, Set, Tuple


# Helper utilities

def _tokenize(text: str) -> Set[str]:
    """Lowercase tokenize a string, stripping basic punctuation."""
    return {
        w.strip(".,;:!?\"'()[]{}") for w in text.lower().split() if len(w) > 2
    }


def _jaccard(set_a: Set[str], set_b: Set[str]) -> float:
    """Jaccard similarity between two sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clamp a value to [lo, hi]."""
    return max(lo, min(hi, value))


# Edge-type weight multipliers (used by composite edge strength)

EDGE_TYPE_WEIGHTS: Dict[str, float] = {
    "builds_upon": 1.0,
    "contradicts": 0.9,
    "relates_to": 0.8,
    "inspired_by": 0.75,
    "sourced_from": 0.7,
    "applied_in": 0.7,
    "mentioned_by": 0.6,
    "temporal": 0.5,
}


# 1. Node importance

def compute_node_importance(
    node_id: str,
    edge_count: int,
    avg_edge_strength: float,
    access_count: int,
    hours_since_last_access: float,
    pagerank_score: float,
    alpha: float = 0.3,
    beta: float = 0.25,
    gamma: float = 0.25,
    delta: float = 0.2,
) -> float:
    """Composite importance score for a node."""
    pagerank = _clamp(pagerank_score)
    edge_density = _clamp(min(edge_count / 10.0, 1.0) * _clamp(avg_edge_strength))
    recency = math.exp(-max(hours_since_last_access, 0.0) / 168.0)
    access_freq = _clamp(min(access_count / 20.0, 1.0))

    raw = alpha * pagerank + beta * edge_density + gamma * recency + delta * access_freq
    return _clamp(raw)


# 2. Cluster density

def compute_cluster_density(nodes: Set[str], edges: List[dict]) -> float:
    """Graph density of a cluster (undirected)."""
    n = len(nodes)
    if n < 2:
        return 0.0

    max_possible = n * (n - 1) / 2.0

    # De-duplicate undirected edges so (a,b) and (b,a) count once.
    seen: Set[FrozenSet[str]] = set()
    for e in edges:
        src = e.get("source", "")
        tgt = e.get("target", "")
        if src in nodes and tgt in nodes and src != tgt:
            seen.add(frozenset((src, tgt)))

    return _clamp(len(seen) / max_possible)


# 3. Cluster coherence (heuristic word-overlap approach)

def compute_cluster_coherence(node_descriptions: List[str]) -> float:
    """Heuristic semantic coherence of a cluster."""
    if len(node_descriptions) <= 1:
        return 1.0 if node_descriptions else 0.0

    token_sets = [_tokenize(d) for d in node_descriptions]
    total_sim = 0.0
    pair_count = 0
    for i in range(len(token_sets)):
        for j in range(i + 1, len(token_sets)):
            total_sim += _jaccard(token_sets[i], token_sets[j])
            pair_count += 1

    return total_sim / pair_count if pair_count > 0 else 0.0


# 4. Knowledge gap detection

def detect_knowledge_gaps(
    communities: List[Set[str]],
    inter_community_edges: Dict[Tuple[int, int], int],
) -> List[dict]:
    """Find under-connected or under-developed areas of the knowledge graph."""
    gaps: List[dict] = []
    n_comm = len(communities)

    # Build a symmetric lookup of inter-community edge counts.
    sym_edges: Dict[Tuple[int, int], int] = defaultdict(int)
    for (a, b), count in inter_community_edges.items():
        key = (min(a, b), max(a, b))
        sym_edges[key] = max(sym_edges[key], count)

    # Per-community total inter-community edge count.
    comm_external: Dict[int, int] = defaultdict(int)
    for (a, b), count in sym_edges.items():
        comm_external[a] += count
        comm_external[b] += count

    for idx, comm in enumerate(communities):
        # Islands — zero external edges
        if comm_external[idx] == 0 and len(comm) >= 1:
            gaps.append({
                "gap_type": "island",
                "community_ids": [idx],
                "description": (
                    f"Community {idx} ({len(comm)} nodes) has no connections "
                    "to any other community."
                ),
                "suggestion": (
                    "Run the Explorer walker starting from a node in this "
                    "community to discover cross-domain connections."
                ),
            })

        # Shallow knowledge — very small communities (1-2 nodes)
        if len(comm) <= 2:
            gaps.append({
                "gap_type": "shallow_knowledge",
                "community_ids": [idx],
                "description": (
                    f"Community {idx} has only {len(comm)} node(s). "
                    "This topic is under-explored."
                ),
                "suggestion": (
                    "Ingest more material on this topic to deepen "
                    "understanding and create richer internal structure."
                ),
            })

    # Missing bridges — large communities with sparse inter-connections.
    large_threshold = 4
    large_comms = [i for i, c in enumerate(communities) if len(c) >= large_threshold]
    for i_idx in range(len(large_comms)):
        for j_idx in range(i_idx + 1, len(large_comms)):
            a, b = large_comms[i_idx], large_comms[j_idx]
            key = (min(a, b), max(a, b))
            edge_count = sym_edges.get(key, 0)
            if edge_count <= 1:
                gaps.append({
                    "gap_type": "missing_bridge",
                    "community_ids": [a, b],
                    "description": (
                        f"Communities {a} ({len(communities[a])} nodes) and "
                        f"{b} ({len(communities[b])} nodes) share only "
                        f"{edge_count} connection(s)."
                    ),
                    "suggestion": (
                        "Look for conceptual bridges between these domains. "
                        "The Explorer walker may find non-obvious links."
                    ),
                })

    return gaps


# 5. Exploration target ranking

def rank_exploration_targets(
    graph_stats: dict,
    communities: List[Set[str]],
    node_importance: Dict[str, float],
) -> List[dict]:
    """Rank nodes as starting points for the Explorer walker."""
    if not node_importance:
        return []

    all_nodes = set(node_importance.keys())
    mean_imp = sum(node_importance.values()) / len(node_importance) if node_importance else 0.0

    # Identify high-importance threshold (top 25 %).
    sorted_scores = sorted(node_importance.values(), reverse=True)
    high_threshold = sorted_scores[max(0, len(sorted_scores) // 4 - 1)] if sorted_scores else 0.0
    low_threshold = sorted_scores[min(len(sorted_scores) - 1, 3 * len(sorted_scores) // 4)] if sorted_scores else 0.0

    # Map node -> set of community indices it belongs to.
    node_to_comms: Dict[str, Set[int]] = defaultdict(set)
    for ci, comm in enumerate(communities):
        for nid in comm:
            node_to_comms[nid].add(ci)

    # High-importance nodes per community.
    comm_high: Dict[int, float] = {}
    for ci, comm in enumerate(communities):
        high_scores = [node_importance.get(n, 0.0) for n in comm if node_importance.get(n, 0.0) >= high_threshold]
        comm_high[ci] = max(high_scores) if high_scores else 0.0

    results: Dict[str, dict] = {}

    # --- Heuristic 1: low importance near high importance ---
    adjacency: Dict[str, List[str]] = graph_stats.get("adjacency", {})
    for nid, imp in node_importance.items():
        if imp >= mean_imp:
            continue
        # Check if any neighbour is high-importance (via adjacency).
        neighbours = adjacency.get(nid, [])
        neighbour_max = max(
            (node_importance.get(nb, 0.0) for nb in neighbours), default=0.0
        )
        # Also check via community membership.
        comm_max = max(
            (comm_high.get(ci, 0.0) for ci in node_to_comms.get(nid, set())),
            default=0.0,
        )
        context_score = max(neighbour_max, comm_max)
        if context_score >= high_threshold:
            priority = (context_score - imp)  # bigger gap = more potential
            if nid not in results or results[nid]["priority"] < priority:
                results[nid] = {
                    "node_id": nid,
                    "priority": round(priority, 4),
                    "reason": "low_importance_near_high",
                }

    # --- Heuristic 2: bridge candidates ---
    for nid in all_nodes:
        if len(node_to_comms.get(nid, set())) > 1:
            priority = 0.5 + 0.1 * len(node_to_comms[nid])
            if nid not in results or results[nid]["priority"] < priority:
                results[nid] = {
                    "node_id": nid,
                    "priority": round(priority, 4),
                    "reason": "bridge_candidate",
                }

    # --- Heuristic 3: recently added / underexplored ---
    for nid, imp in node_importance.items():
        if imp <= low_threshold and nid not in results:
            priority = 0.3 * (1.0 - imp)
            results[nid] = {
                "node_id": nid,
                "priority": round(priority, 4),
                "reason": "underexplored",
            }

    ranked = sorted(results.values(), key=lambda r: r["priority"], reverse=True)
    return ranked


# 6. Composite edge strength

def compute_edge_strength_composite(
    strength: float,
    reinforcement_count: int,
    edge_type: str,
    hours_since_creation: float,
) -> float:
    """Composite edge strength considering multiple factors."""
    raw = _clamp(strength) * 0.4

    reinforcement = _clamp(min(reinforcement_count / 10.0, 1.0)) * 0.25

    type_weight = EDGE_TYPE_WEIGHTS.get(edge_type, 0.5)
    type_component = type_weight * 0.2

    age_factor = 1.0 - math.exp(-max(hours_since_creation, 0.0) / 720.0)
    age_component = age_factor * 0.15

    return _clamp(raw + reinforcement + type_component + age_component)


# 7. Aggregate knowledge statistics

def compute_knowledge_stats(
    nodes: List[dict],
    edges: List[dict],
    communities: List[Set[str]],
) -> dict:
    """Aggregate statistics for the knowledge graph."""
    total_nodes = len(nodes)
    total_edges = len(edges)

    # Average importance.
    importances = [n.get("importance", 0.0) for n in nodes]
    avg_importance = sum(importances) / len(importances) if importances else 0.0

    # Average edge strength.
    strengths = [e.get("strength", 0.0) for e in edges]
    avg_edge_strength = sum(strengths) / len(strengths) if strengths else 0.0

    # Community stats.
    num_communities = len(communities)

    # Build per-community density.
    comm_densities: List[Tuple[int, float]] = []
    for ci, comm in enumerate(communities):
        density = compute_cluster_density(comm, edges)
        comm_densities.append((ci, density))

    if comm_densities:
        strongest = max(comm_densities, key=lambda x: x[1])
        weakest = min(comm_densities, key=lambda x: x[1])
        strongest_community = {"index": strongest[0], "density": round(strongest[1], 4)}
        weakest_community = {"index": weakest[0], "density": round(weakest[1], 4)}
    else:
        strongest_community = None
        weakest_community = None

    # Orphans — nodes with fewer than 2 edges.
    node_edge_count: Dict[str, int] = defaultdict(int)
    for e in edges:
        node_edge_count[e.get("source", "")] += 1
        node_edge_count[e.get("target", "")] += 1
    node_ids = {n.get("id", "") for n in nodes}
    num_orphans = sum(1 for nid in node_ids if node_edge_count.get(nid, 0) < 2)

    # Count by type.
    type_counts: Dict[str, int] = defaultdict(int)
    for n in nodes:
        type_counts[n.get("type", "unknown")] += 1
    num_insights = type_counts.get("Insight", 0) + type_counts.get("insight", 0)
    num_sources = type_counts.get("Source", 0) + type_counts.get("source", 0)

    # Knowledge coverage — fraction of distinct domains represented.
    domains = {n.get("domain", "") for n in nodes if n.get("domain")}
    # We don't know the "total possible" domains, so report count.
    knowledge_coverage = len(domains)

    return {
        "total_nodes": total_nodes,
        "total_edges": total_edges,
        "avg_importance": round(avg_importance, 4),
        "avg_edge_strength": round(avg_edge_strength, 4),
        "num_communities": num_communities,
        "strongest_community": strongest_community,
        "weakest_community": weakest_community,
        "num_orphans": num_orphans,
        "num_insights": num_insights,
        "num_sources": num_sources,
        "knowledge_coverage": knowledge_coverage,
    }
