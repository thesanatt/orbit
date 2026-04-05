# ORBIT

Your second brain that actually thinks.

You paste in your notes. ORBIT builds a knowledge graph out of them and sends little AI agents (walkers) to roam around finding connections you'd never see on your own. Ask a question and you literally watch a walker hop from node to node to find the answer.

Built at JacHacks 2026 (UMich Ann Arbor). Solo project.

**Live demo:** https://orbit-roan-seven.vercel.app (hosted on Vercel, backends on Render free tier so first load is slow as the servers wake up, give it 30 seconds)

## How to run it

You need two things running at the same time.

```bash
# the jac backend (this is the whole brain)
source venv/bin/activate
jac start src/app.jac

# the react frontend (the glowing graph)
npm run dev
```

Also needs a `.env` file with `GROQ_API_KEY=sk-...` because the walkers use `by llm()` for their thinking.

## Where the Jac code is (for judges)

If you're skimming, here's the map:

```
src/
  app.jac                   <- entry point, REST API endpoints
  graph/
    nodes.jac               <- 6 node archetypes
    edges.jac               <- 8 edge archetypes
    seed.jac                <- loads demo knowledge base into the graph
  walkers/
    ingestor.jac            <- ingest text + walk to find connections
    explorer.jac            <- autonomous random walk (finds hidden insights)
    pathfinder.jac          <- answers questions by walking between concepts
    consolidator.jac        <- detects decaying edges + orphan nodes
    cartographer.jac        <- maps knowledge territory by domain
  ai/
    extract.jac             <- concept + people + relationship extraction
    assess.jac              <- relationship scoring, contradiction detection
    synthesize.jac          <- insight generation, answer synthesis
    narrate.jac             <- path narration, digest generation
  engine/
    graph_ops.py            <- BFS, PageRank, Louvain, Brandes centrality
    decay.py                <- Ebbinghaus forgetting curve math
    scoring.py              <- node importance, cluster density
```

14 `.jac` files total. `jac check src/app.jac` compiles the whole thing. Once running, go to `localhost:8000/docs` for the Swagger UI with every walker endpoint.

## Why Jac is the whole backbone

The entire backend is written in Jac. Like, I don't think this project could exist in regular Python. The whole idea is that knowledge is a graph and understanding is walking through it, and Jac has walkers and nodes and edges as first class things in the language.

Here's the rough shape of it:

* `src/graph/nodes.jac` has 6 kinds of nodes (Concept, Source, Insight, Question, Person, Project).
* `src/graph/edges.jac` has 8 kinds of edges (relates_to, builds_upon, contradicts, sourced_from, inspired_by, applied_in, mentioned_by, temporal).
* `src/walkers/` has 5 walker agents. Each one does a different kind of graph traversal:
  * **Ingestor** takes text, pulls out concepts with `by llm()`, then walks the existing graph to wire new stuff in.
  * **Explorer** does a weighted random walk biased toward weak edges. Finds hidden connections on its own (runs in the background every 75 seconds).
  * **Pathfinder** answers your questions. It finds the concepts in your question, walks between them, scores paths by relevance, then writes an answer based on the path it walked. The path IS the reasoning.
  * **Consolidator** finds edges that are decaying (Ebbinghaus forgetting curve) and flags stuff you're forgetting.
  * **Cartographer** maps out your intellectual territory by domain.
* `src/ai/` has all the `by llm()` functions. I tuned temperature per function (0.0 for assessment, 0.7 for creative synthesis).
* `src/app.jac` is the entry point. Running `jac start src/app.jac` spins up a REST API on port 8000 with swagger docs automatically. Every walker becomes an endpoint.

I use almost every Jac feature I could find: `visit`, `disengage`, `report`, `here`, `root()`, walker abilities with `entry`/`exit`, typed edges with `+>: :+>`, `walker:pub` for REST exposure, `sem` annotations for LLM prompts, `obj` for structured outputs, Python interop for the math heavy stuff.

## How I use InsForge

InsForge is the persistence layer and realtime sync. Two things:

1. **Postgres storage for the graph.** Every node, edge, and insight gets saved to InsForge's database tables (`knowledge_nodes`, `knowledge_edges`) as soon as it's created. So if you close your browser your brain is still there tomorrow. I use a stable per-browser user id from localStorage to keep each person's graph separate.

2. **Realtime websocket sync across tabs.** When you ingest a new note, the change gets published to an InsForge realtime channel (`orbit:{user_id}`). Open ORBIT in two tabs at once and watch the second tab update live when you change something in the first. This was actually pretty cool to get working.

The footer shows the InsForge sync status with a little dot. Green means synced, gold flashing means a live event just came in from another tab.

## The force directed graph viz

It's `react-force-graph-2d` with a dark space theme. Nodes glow, edges light up when a walker traverses them, there's a starfield in the background. The walker trail animation when Pathfinder answers a question is the coolest part I think. You can see every hop.

## Edge decay (spaced repetition on your whole brain)

Every edge has a strength from 0 to 1. When you visit a path, the edges on it get boosted (+0.15) and edges touching visited nodes get a smaller boost (+0.04) because of associative activation. Edges you don't visit decay according to `S(t) = S_0 * e^(-lambda*t) + S_base`. Different edge types decay at different rates (builds_upon is structural so it barely decays, temporal decays fast).

So your graph is alive. Unused knowledge fades. Things you keep coming back to stay strong.

## Stack

* Jac (Jaseci) for the whole backend, walkers, and `by llm()`
* React + react-force-graph-2d for the viz
* Python (via Jac superset) for graph algorithms (BFS, Louvain clustering, PageRank, Brandes centrality)
* InsForge for Postgres storage and realtime websocket pub/sub
* Groq (llama-3.1-8b-instant) for the actual LLM inference

## Sanat Gupta

CS BSE at University of Michigan. This was my first time using Jac and honestly I'm a fan.
