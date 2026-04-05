"""
Tests for ORBIT node & edge scoring engine.

Covers: compute_node_importance, compute_cluster_density,
compute_cluster_coherence, detect_knowledge_gaps,
rank_exploration_targets, compute_edge_strength_composite,
compute_knowledge_stats.
"""

import math

import pytest

from engine.scoring import (
    EDGE_TYPE_WEIGHTS,
    compute_cluster_coherence,
    compute_cluster_density,
    compute_edge_strength_composite,
    compute_knowledge_stats,
    compute_node_importance,
    detect_knowledge_gaps,
    rank_exploration_targets,
)


# =========================================================================
# compute_node_importance (scoring module version)
# =========================================================================


class TestComputeNodeImportance:

    def test_result_in_range(self):
        score = compute_node_importance(
            node_id="test",
            edge_count=5,
            avg_edge_strength=0.6,
            access_count=10,
            hours_since_last_access=24.0,
            pagerank_score=0.5,
        )
        assert 0.0 <= score <= 1.0

    def test_zero_everything(self):
        score = compute_node_importance(
            node_id="test",
            edge_count=0,
            avg_edge_strength=0.0,
            access_count=0,
            hours_since_last_access=0.0,
            pagerank_score=0.0,
        )
        assert 0.0 <= score <= 1.0
        # recency component: e^0 = 1.0, so score won't be zero
        # gamma * 1.0 = 0.25 by default
        assert score > 0.0

    def test_max_everything(self):
        score = compute_node_importance(
            node_id="test",
            edge_count=100,
            avg_edge_strength=1.0,
            access_count=100,
            hours_since_last_access=0.0,
            pagerank_score=1.0,
        )
        assert abs(score - 1.0) < 1e-6

    def test_weights_sum(self):
        # Default weights: alpha=0.3, beta=0.25, gamma=0.25, delta=0.2
        assert abs(0.3 + 0.25 + 0.25 + 0.2 - 1.0) < 1e-9

    def test_custom_weights(self):
        # Only pagerank matters
        score = compute_node_importance(
            node_id="test",
            edge_count=100,
            avg_edge_strength=1.0,
            access_count=100,
            hours_since_last_access=0.0,
            pagerank_score=0.5,
            alpha=1.0, beta=0.0, gamma=0.0, delta=0.0,
        )
        assert abs(score - 0.5) < 1e-6

    def test_recency_decreases_with_time(self):
        recent = compute_node_importance(
            "n", 5, 0.5, 5, 1.0, 0.5)
        old = compute_node_importance(
            "n", 5, 0.5, 5, 5000.0, 0.5)
        assert recent > old

    def test_negative_hours_treated_as_zero(self):
        score = compute_node_importance(
            "n", 5, 0.5, 5, -10.0, 0.5)
        assert 0.0 <= score <= 1.0


# =========================================================================
# compute_cluster_density
# =========================================================================


class TestComputeClusterDensity:

    def test_complete_graph_density_one(self):
        nodes = {"a", "b", "c"}
        edges = [
            {"source": "a", "target": "b"},
            {"source": "a", "target": "c"},
            {"source": "b", "target": "c"},
        ]
        density = compute_cluster_density(nodes, edges)
        assert abs(density - 1.0) < 1e-9

    def test_empty_cluster(self):
        assert compute_cluster_density(set(), []) == 0.0

    def test_single_node(self):
        assert compute_cluster_density({"a"}, []) == 0.0

    def test_no_internal_edges(self):
        nodes = {"a", "b", "c"}
        # Edges between nodes NOT in the cluster
        edges = [{"source": "x", "target": "y"}]
        density = compute_cluster_density(nodes, edges)
        assert density == 0.0

    def test_partial_connectivity(self):
        nodes = {"a", "b", "c", "d"}
        # 2 out of 6 possible edges
        edges = [
            {"source": "a", "target": "b"},
            {"source": "c", "target": "d"},
        ]
        density = compute_cluster_density(nodes, edges)
        expected = 2.0 / 6.0
        assert abs(density - expected) < 1e-9

    def test_duplicate_undirected_edges(self):
        nodes = {"a", "b"}
        # Both directions of the same edge
        edges = [
            {"source": "a", "target": "b"},
            {"source": "b", "target": "a"},
        ]
        density = compute_cluster_density(nodes, edges)
        # Should count as 1 edge, max possible = 1
        assert abs(density - 1.0) < 1e-9

    def test_self_loops_excluded(self):
        nodes = {"a", "b"}
        edges = [
            {"source": "a", "target": "a"},  # self-loop
        ]
        density = compute_cluster_density(nodes, edges)
        assert density == 0.0


# =========================================================================
# compute_cluster_coherence
# =========================================================================


class TestComputeClusterCoherence:

    def test_identical_descriptions(self):
        descs = ["machine learning algorithms", "machine learning algorithms"]
        coherence = compute_cluster_coherence(descs)
        assert abs(coherence - 1.0) < 1e-9

    def test_empty_input(self):
        assert compute_cluster_coherence([]) == 0.0

    def test_single_description(self):
        assert compute_cluster_coherence(["hello world"]) == 1.0

    def test_completely_different(self):
        descs = ["alpha bravo charlie", "delta echo foxtrot"]
        coherence = compute_cluster_coherence(descs)
        assert coherence == 0.0

    def test_partial_overlap(self):
        descs = [
            "machine learning neural networks",
            "machine learning deep learning",
        ]
        coherence = compute_cluster_coherence(descs)
        assert 0.0 < coherence < 1.0

    def test_short_words_filtered(self):
        # Words with len <= 2 are filtered by _tokenize
        descs = ["a b c d e f", "a b c d e f"]
        coherence = compute_cluster_coherence(descs)
        # All words are short, so token sets are empty -> jaccard = 0
        assert coherence == 0.0


# =========================================================================
# detect_knowledge_gaps
# =========================================================================


class TestDetectKnowledgeGaps:

    def test_finds_islands(self):
        communities = [{"a", "b", "c"}, {"d", "e"}, {"f"}]
        # Only 0 and 1 connected
        inter_edges = {(0, 1): 3}
        gaps = detect_knowledge_gaps(communities, inter_edges)
        island_gaps = [g for g in gaps if g["gap_type"] == "island"]
        island_community_ids = []
        for ig in island_gaps:
            island_community_ids.extend(ig["community_ids"])
        # Community 2 ({"f"}) has no inter-community edges
        assert 2 in island_community_ids

    def test_finds_shallow_communities(self):
        communities = [{"a", "b", "c", "d", "e"}, {"f"}]
        inter_edges = {(0, 1): 1}
        gaps = detect_knowledge_gaps(communities, inter_edges)
        shallow = [g for g in gaps if g["gap_type"] == "shallow_knowledge"]
        # Community 1 has only 1 node -> shallow
        assert len(shallow) >= 1

    def test_finds_missing_bridges(self):
        # Two large communities with no connection
        communities = [
            {"a1", "a2", "a3", "a4"},
            {"b1", "b2", "b3", "b4"},
        ]
        inter_edges = {}  # no connections
        gaps = detect_knowledge_gaps(communities, inter_edges)
        bridge_gaps = [g for g in gaps if g["gap_type"] == "missing_bridge"]
        assert len(bridge_gaps) >= 1

    def test_no_gaps_in_connected_graph(self):
        communities = [
            {"a1", "a2", "a3", "a4"},
            {"b1", "b2", "b3", "b4"},
        ]
        inter_edges = {(0, 1): 5}  # well connected
        gaps = detect_knowledge_gaps(communities, inter_edges)
        bridge_gaps = [g for g in gaps if g["gap_type"] == "missing_bridge"]
        assert len(bridge_gaps) == 0

    def test_empty_communities(self):
        gaps = detect_knowledge_gaps([], {})
        assert gaps == []


# =========================================================================
# rank_exploration_targets
# =========================================================================


class TestRankExplorationTargets:

    def test_returns_sorted(self):
        communities = [{"a", "b", "c"}, {"d", "e"}]
        importance = {"a": 0.9, "b": 0.1, "c": 0.5, "d": 0.8, "e": 0.2}
        graph_stats = {"adjacency": {
            "a": ["b", "c"], "b": ["a"], "c": ["a"], "d": ["e"], "e": ["d"]
        }}
        results = rank_exploration_targets(graph_stats, communities, importance)
        if len(results) >= 2:
            for i in range(len(results) - 1):
                assert results[i]["priority"] >= results[i + 1]["priority"]

    def test_empty_importance(self):
        results = rank_exploration_targets({}, [], {})
        assert results == []

    def test_result_structure(self):
        communities = [{"a", "b"}]
        importance = {"a": 0.9, "b": 0.1}
        graph_stats = {"adjacency": {"a": ["b"], "b": ["a"]}}
        results = rank_exploration_targets(graph_stats, communities, importance)
        for r in results:
            assert "node_id" in r
            assert "priority" in r
            assert "reason" in r

    def test_bridge_candidates_detected(self):
        # Node "bridge" is in two communities
        communities = [{"a", "bridge"}, {"b", "bridge"}]
        importance = {"a": 0.5, "b": 0.5, "bridge": 0.5}
        graph_stats = {"adjacency": {}}
        results = rank_exploration_targets(graph_stats, communities, importance)
        bridge_results = [r for r in results if r["node_id"] == "bridge"]
        assert len(bridge_results) >= 1
        assert bridge_results[0]["reason"] == "bridge_candidate"


# =========================================================================
# compute_edge_strength_composite
# =========================================================================


class TestComputeEdgeStrengthComposite:

    def test_result_in_range(self):
        score = compute_edge_strength_composite(
            strength=0.7, reinforcement_count=5,
            edge_type="relates_to", hours_since_creation=100.0,
        )
        assert 0.0 <= score <= 1.0

    def test_all_factors_contribute(self):
        zero_score = compute_edge_strength_composite(
            strength=0.0, reinforcement_count=0,
            edge_type="temporal", hours_since_creation=0.0,
        )
        max_score = compute_edge_strength_composite(
            strength=1.0, reinforcement_count=100,
            edge_type="builds_upon", hours_since_creation=10000.0,
        )
        assert max_score > zero_score

    def test_unknown_edge_type(self):
        score = compute_edge_strength_composite(
            strength=0.5, reinforcement_count=5,
            edge_type="unknown_type", hours_since_creation=100.0,
        )
        assert 0.0 <= score <= 1.0

    @pytest.mark.parametrize("edge_type", list(EDGE_TYPE_WEIGHTS.keys()))
    def test_all_known_edge_types(self, edge_type):
        score = compute_edge_strength_composite(
            strength=0.5, reinforcement_count=3,
            edge_type=edge_type, hours_since_creation=48.0,
        )
        assert 0.0 <= score <= 1.0

    def test_negative_hours_handled(self):
        score = compute_edge_strength_composite(
            strength=0.5, reinforcement_count=3,
            edge_type="relates_to", hours_since_creation=-10.0,
        )
        assert 0.0 <= score <= 1.0

    def test_high_reinforcement_count(self):
        low = compute_edge_strength_composite(
            strength=0.5, reinforcement_count=1,
            edge_type="relates_to", hours_since_creation=100.0,
        )
        high = compute_edge_strength_composite(
            strength=0.5, reinforcement_count=50,
            edge_type="relates_to", hours_since_creation=100.0,
        )
        assert high >= low


# =========================================================================
# compute_knowledge_stats
# =========================================================================


class TestComputeKnowledgeStats:

    def test_basic_counts(self):
        nodes = [
            {"id": "n1", "type": "Concept", "importance": 0.8},
            {"id": "n2", "type": "Source", "importance": 0.5},
            {"id": "n3", "type": "Insight", "importance": 0.9},
        ]
        edges = [
            {"source": "n1", "target": "n2", "strength": 0.7},
            {"source": "n2", "target": "n3", "strength": 0.3},
        ]
        communities = [{"n1", "n2"}, {"n3"}]
        stats = compute_knowledge_stats(nodes, edges, communities)

        assert stats["total_nodes"] == 3
        assert stats["total_edges"] == 2
        assert stats["num_communities"] == 2
        assert stats["num_insights"] == 1
        assert stats["num_sources"] == 1

    def test_empty_inputs(self):
        stats = compute_knowledge_stats([], [], [])
        assert stats["total_nodes"] == 0
        assert stats["total_edges"] == 0
        assert stats["avg_importance"] == 0.0
        assert stats["avg_edge_strength"] == 0.0
        assert stats["num_communities"] == 0

    def test_avg_importance(self):
        nodes = [
            {"id": "n1", "type": "Concept", "importance": 0.6},
            {"id": "n2", "type": "Concept", "importance": 0.4},
        ]
        stats = compute_knowledge_stats(nodes, [], [])
        assert abs(stats["avg_importance"] - 0.5) < 1e-4

    def test_avg_edge_strength(self):
        edges = [
            {"source": "a", "target": "b", "strength": 0.8},
            {"source": "b", "target": "c", "strength": 0.2},
        ]
        stats = compute_knowledge_stats([], edges, [])
        assert abs(stats["avg_edge_strength"] - 0.5) < 1e-4

    def test_orphan_count(self):
        nodes = [
            {"id": "n1", "type": "Concept"},
            {"id": "n2", "type": "Concept"},
            {"id": "n3", "type": "Concept"},
        ]
        # Only n1-n2 connected, n3 is orphan (0 edges), n1 and n2 have 1 each
        edges = [{"source": "n1", "target": "n2", "strength": 0.5}]
        stats = compute_knowledge_stats(nodes, edges, [])
        # n1: 1 edge, n2: 1 edge, n3: 0 edges. All < 2 => all 3 are orphans
        assert stats["num_orphans"] == 3

    def test_knowledge_coverage(self):
        nodes = [
            {"id": "n1", "type": "Concept", "domain": "cs"},
            {"id": "n2", "type": "Concept", "domain": "cs"},
            {"id": "n3", "type": "Concept", "domain": "math"},
        ]
        stats = compute_knowledge_stats(nodes, [], [])
        assert stats["knowledge_coverage"] == 2

    def test_strongest_weakest_community(self):
        nodes = [
            {"id": "a", "type": "Concept"},
            {"id": "b", "type": "Concept"},
            {"id": "c", "type": "Concept"},
            {"id": "d", "type": "Concept"},
        ]
        edges = [
            {"source": "a", "target": "b", "strength": 0.9},
            # c and d have no edges between them
        ]
        communities = [{"a", "b"}, {"c", "d"}]
        stats = compute_knowledge_stats(nodes, edges, communities)
        assert stats["strongest_community"]["density"] > stats["weakest_community"]["density"]
