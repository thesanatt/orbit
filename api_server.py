"""
ORBIT API Server - Connects the frontend to real LLM calls via Groq.
Run: python api_server.py
Serves on port 3001, frontend proxies to it.
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.1-8b-instant"

# Load demo knowledge for context
DEMO_DATA = None
def load_demo():
    global DEMO_DATA
    try:
        with open("data/demo_knowledge.json") as f:
            DEMO_DATA = json.load(f)
    except:
        DEMO_DATA = {"nodes": [], "edges": []}

def call_llm(system_prompt, user_prompt, max_tokens=500):
    """Call Groq API and return the response text."""
    body = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.7
    }).encode()

    req = Request(GROQ_URL, data=body, headers={
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "ORBIT/1.0"
    })

    try:
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Error: {str(e)}"


def handle_ask(question, graph_nodes, path_nodes=None):
    """Answer a question by explaining the specific path found in the graph."""

    system = """You explain surprising connections between ideas by walking through a conceptual path.

Style:
- Write 2 to 3 sentences. Tight, dense, substantive. No filler.
- Lead with the core insight — what's the surprising link?
- Reference specific concepts by name only when it sharpens the point.
- Sound like a smart friend dropping a "wait, actually..." observation.
- No bullet points, no lists, no dashes, no hedging ("it could be argued", "this highlights how"). Plain prose only."""

    if path_nodes and len(path_nodes) > 1:
        # Keep only start, end, and up to 3 key middle nodes for a focused answer
        if len(path_nodes) > 5:
            path_nodes = [path_nodes[0], path_nodes[len(path_nodes)//3], path_nodes[2*len(path_nodes)//3], path_nodes[-1]]
        path_str = " -> ".join([n['name'] for n in path_nodes])
        path_desc = "\n".join([f"{n['name']}: {n.get('description', '')[:60]}" for n in path_nodes])
        user = f"""Path: {path_str}

{path_desc}

Question: {question}

Explain the connection in exactly 2-3 sentences. Go straight to the insight. No throat-clearing."""
    else:
        user = f"""Question: {question}

No path found. Say in one sentence: "I don't have enough in your notes to connect those yet. Try adding more about [topic]." """

    return call_llm(system, user, 180)


def handle_ingest(text, source_type):
    """Extract entities (concepts, people, projects) from pasted text."""
    system = """You are an entity extractor for a personal knowledge graph. Given text, extract 1-4 key entities and CLASSIFY each one.

Return ONLY a JSON array of objects with these fields:
- "name": short canonical name (2-4 words)
- "type": one of "Concept", "Person", "Project"
- "description": one clear sentence

Classification rules:
- "Person" = a real human being (e.g. "Jason Mars", "Andrew Huberman", "Cal Newport"). Proper first+last names of people.
- "Project" = a specific initiative, app, or named undertaking (e.g. "ORBIT", "Summer Internship Prep").
- "Concept" = ideas, methods, phenomena, fields (e.g. "compound growth", "machine learning", "spaced repetition").

If the text is just "X is smart" or "I met X", extract X as a Person (not a Concept).
No jargon. No em dashes. Return JSON array only, no markdown, no backticks."""

    user = f"""Extract entities from this {source_type}:

"{text}"

Return JSON array only."""

    result = call_llm(system, user, 300)

    # Try to parse JSON from the response
    try:
        # Strip any markdown formatting
        clean = result.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(clean)
    except:
        return [{"name": "New Concept", "description": result[:100]}]


def handle_connect(new_concepts, existing_nodes):
    """Find which existing nodes each new concept should connect to."""
    existing_names = [n.get('name', '') for n in existing_nodes[:80]]
    concept_names = [c.get('name', '') for c in new_concepts]

    system = """You match new concepts to EXISTING concepts in a knowledge graph.
CRITICAL RULES:
- target MUST be copied EXACTLY from the existing list provided. No variations, no new names.
- source MUST be copied EXACTLY from the new concepts list.
- Pick 2-3 BEST matches for each new concept.
- If no good match exists, skip that new concept.
Return ONLY a JSON array: [{"source":"...","target":"...","relationship":"..."}]"""

    user = f"""NEW CONCEPTS (copy these names exactly as source):
{json.dumps(concept_names)}

EXISTING CONCEPTS (copy these names exactly as target):
{json.dumps(existing_names)}

For each new concept, find 2-3 existing concepts it connects to. Copy names EXACTLY from above."""

    result = call_llm(system, user, 500)
    try:
        clean = result.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(clean)
    except:
        return []


def handle_quiz(node_a, node_b, user_answer, actual_relationship):
    """Grade a user's understanding of how two concepts connect."""
    system = """You're grading a student's understanding of how two concepts connect.
Rules:
- If they got the gist right (even roughly), say "Nice! You got it." then add one extra detail.
- If they're wrong, say "Not quite." then explain the real connection in 1-2 sentences.
- Be encouraging, not harsh. Keep it to 2 sentences max.
- No dashes, no bullet points."""

    user = f"How does {node_a} connect to {node_b}?\nTheir answer: {user_answer}\nActual connection: {actual_relationship}\n\nGrade their answer."
    return call_llm(system, user, 80)


class OrbitHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        if self.path == "/api/ask":
            question = body.get("question", "")
            path_nodes = body.get("path_nodes", None)
            answer = handle_ask(question, DEMO_DATA.get("nodes", []), path_nodes)
            self.wfile.write(json.dumps({"answer": answer}).encode())

        elif self.path == "/api/ingest":
            text = body.get("text", "")
            source_type = body.get("source_type", "note")
            concepts = handle_ingest(text, source_type)
            self.wfile.write(json.dumps({"concepts": concepts}).encode())

        elif self.path == "/api/connect":
            new_concepts = body.get("new_concepts", [])
            existing_nodes = body.get("existing_nodes", DEMO_DATA.get("nodes", []))
            connections = handle_connect(new_concepts, existing_nodes)
            self.wfile.write(json.dumps({"connections": connections}).encode())

        elif self.path == "/api/quiz":
            node_a = body.get("node_a", "")
            node_b = body.get("node_b", "")
            user_answer = body.get("user_answer", "")
            actual_relationship = body.get("actual_relationship", "")
            feedback = handle_quiz(node_a, node_b, user_answer, actual_relationship)
            self.wfile.write(json.dumps({"feedback": feedback}).encode())

        else:
            self.wfile.write(json.dumps({"error": "unknown endpoint"}).encode())

    def log_message(self, format, *args):
        print(f"[ORBIT API] {args[0]}")


if __name__ == "__main__":
    if not GROQ_API_KEY:
        print("ERROR: Set GROQ_API_KEY environment variable")
        sys.exit(1)

    load_demo()
    print(f"ORBIT API Server starting on port 3001")
    print(f"Using model: {MODEL}")
    print(f"Loaded {len(DEMO_DATA.get('nodes', []))} nodes")
    server = HTTPServer(("127.0.0.1", 3001), OrbitHandler)
    print("Ready - http://localhost:3001")
    server.serve_forever()
