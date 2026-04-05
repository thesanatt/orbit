"""
Validation tests for the demo knowledge base JSON.

Ensures data integrity: valid schema, no dangling references,
no duplicate IDs, correct types, and text quality.
"""

import json
import os

import pytest

DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "demo_knowledge.json",
)

VALID_NODE_TYPES = {"Concept", "Source", "Insight", "Person", "Project"}
VALID_EDGE_TYPES = {
    "relates_to",
    "builds_upon",
    "contradicts",
    "sourced_from",
    "inspired_by",
    "applied_in",
    "mentioned_by",
}


@pytest.fixture(scope="module")
def demo_json():
    with open(DATA_PATH, "r") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def nodes(demo_json):
    return demo_json["nodes"]


@pytest.fixture(scope="module")
def edges(demo_json):
    return demo_json["edges"]


@pytest.fixture(scope="module")
def node_ids(nodes):
    return {n["id"] for n in nodes}


# =========================================================================
# JSON structure
# =========================================================================


class TestJSONStructure:

    def test_json_is_valid(self):
        with open(DATA_PATH, "r") as f:
            data = json.load(f)
        assert isinstance(data, dict)

    def test_has_nodes_key(self, demo_json):
        assert "nodes" in demo_json
        assert isinstance(demo_json["nodes"], list)

    def test_has_edges_key(self, demo_json):
        assert "edges" in demo_json
        assert isinstance(demo_json["edges"], list)

    def test_nodes_not_empty(self, nodes):
        assert len(nodes) > 0

    def test_edges_not_empty(self, edges):
        assert len(edges) > 0


# =========================================================================
# Node validation
# =========================================================================


class TestNodeValidation:

    def test_all_nodes_have_id(self, nodes):
        for node in nodes:
            assert "id" in node, f"Node missing 'id': {node}"

    def test_all_nodes_have_type(self, nodes):
        for node in nodes:
            assert "type" in node, f"Node {node.get('id', '?')} missing 'type'"

    def test_all_nodes_have_name_or_title(self, nodes):
        for node in nodes:
            has_name = "name" in node and node["name"]
            has_title = "title" in node and node["title"]
            assert has_name or has_title, (
                f"Node {node['id']} missing 'name' or 'title'"
            )

    def test_node_types_are_valid(self, nodes):
        for node in nodes:
            assert node["type"] in VALID_NODE_TYPES, (
                f"Node {node['id']} has invalid type '{node['type']}'. "
                f"Valid types: {VALID_NODE_TYPES}"
            )

    def test_no_duplicate_node_ids(self, nodes):
        ids = [n["id"] for n in nodes]
        assert len(ids) == len(set(ids)), (
            f"Duplicate node IDs found: "
            f"{[x for x in ids if ids.count(x) > 1]}"
        )

    def test_concept_nodes_have_description(self, nodes):
        concepts = [n for n in nodes if n["type"] == "Concept"]
        for c in concepts:
            assert "description" in c and c["description"], (
                f"Concept node {c['id']} missing description"
            )

    def test_concept_nodes_have_domain(self, nodes):
        concepts = [n for n in nodes if n["type"] == "Concept"]
        for c in concepts:
            assert "domain" in c, (
                f"Concept node {c['id']} missing domain"
            )


# =========================================================================
# Edge validation
# =========================================================================


class TestEdgeValidation:

    def test_all_edges_have_source(self, edges):
        for i, edge in enumerate(edges):
            assert "source" in edge, f"Edge {i} missing 'source'"

    def test_all_edges_have_target(self, edges):
        for i, edge in enumerate(edges):
            assert "target" in edge, f"Edge {i} missing 'target'"

    def test_all_edges_have_type(self, edges):
        for i, edge in enumerate(edges):
            assert "type" in edge, f"Edge {i} missing 'type'"

    def test_edge_types_are_valid(self, edges):
        for i, edge in enumerate(edges):
            assert edge["type"] in VALID_EDGE_TYPES, (
                f"Edge {i} ({edge['source']}->{edge['target']}) has "
                f"invalid type '{edge['type']}'. Valid: {VALID_EDGE_TYPES}"
            )

    def test_no_dangling_source_references(self, edges, node_ids):
        for i, edge in enumerate(edges):
            assert edge["source"] in node_ids, (
                f"Edge {i} source '{edge['source']}' is not a valid node ID"
            )

    def test_no_dangling_target_references(self, edges, node_ids):
        for i, edge in enumerate(edges):
            assert edge["target"] in node_ids, (
                f"Edge {i} target '{edge['target']}' is not a valid node ID"
            )

    def test_no_self_loops(self, edges):
        for i, edge in enumerate(edges):
            assert edge["source"] != edge["target"], (
                f"Edge {i} is a self-loop on '{edge['source']}'"
            )

    def test_no_duplicate_edges(self, edges):
        seen = set()
        for i, edge in enumerate(edges):
            key = (edge["source"], edge["target"], edge["type"])
            assert key not in seen, (
                f"Duplicate edge {i}: {edge['source']}-[{edge['type']}]->{edge['target']}"
            )
            seen.add(key)

    def test_all_edges_have_strength(self, edges):
        for i, edge in enumerate(edges):
            assert "strength" in edge, f"Edge {i} missing 'strength'"
            assert 0.0 <= edge["strength"] <= 1.0, (
                f"Edge {i} strength {edge['strength']} out of [0,1] range"
            )

    def test_contradiction_edges_exist(self, edges):
        contradictions = [e for e in edges if e["type"] == "contradicts"]
        assert len(contradictions) >= 1, (
            "No contradiction edges found. The demo should have at least one."
        )


# =========================================================================
# Connectivity
# =========================================================================


class TestConnectivity:

    def test_every_node_has_at_least_one_edge(self, nodes, edges, node_ids):
        """Each node should participate in at least one edge."""
        nodes_with_edges = set()
        for edge in edges:
            nodes_with_edges.add(edge["source"])
            nodes_with_edges.add(edge["target"])
        disconnected = node_ids - nodes_with_edges
        assert len(disconnected) == 0, (
            f"Nodes with zero edges: {disconnected}"
        )


# =========================================================================
# Insight path validation
# =========================================================================


class TestInsightPaths:

    def test_insight_nodes_have_description(self, nodes):
        insights = [n for n in nodes if n["type"] == "Insight"]
        for ins in insights:
            assert "description" in ins and ins["description"], (
                f"Insight node {ins['id']} missing description"
            )


# =========================================================================
# Text quality
# =========================================================================


class TestTextQuality:

    def _check_no_special_dashes(self, text, context):
        """Check for em dashes and en dashes."""
        em_dash = "\u2014"  # em dash
        en_dash = "\u2013"  # en dash
        assert em_dash not in text, (
            f"Em dash found in {context}: ...{text[max(0,text.index(em_dash)-20):text.index(em_dash)+20]}..."
        )
        assert en_dash not in text, (
            f"En dash found in {context}: ...{text[max(0,text.index(en_dash)-20):text.index(en_dash)+20]}..."
        )

    def test_no_dashes_in_node_names(self, nodes):
        for node in nodes:
            name = node.get("name", node.get("title", ""))
            self._check_no_special_dashes(name, f"node {node['id']} name")

    def test_no_dashes_in_node_descriptions(self, nodes):
        for node in nodes:
            desc = node.get("description", "")
            if desc:
                self._check_no_special_dashes(desc, f"node {node['id']} description")

    def test_no_dashes_in_edge_relationships(self, edges):
        for i, edge in enumerate(edges):
            rel = edge.get("relationship", "")
            if rel:
                self._check_no_special_dashes(rel, f"edge {i} relationship")
