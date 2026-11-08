# UBC SideQuest

Make new friends at UBC through spontaneous, low-pressure campus quests. Sign in, set your interests, join the queue, get matched with another student, and complete the same AI-generated quest together.

## Repository layout

| Folder | What | Owner | Start here |
| --- | --- | --- | --- |
| [`frontend/`](frontend/) | Web app (Lovable, TanStack Start + React) | Person 1 | `cd frontend && bun install && bun run dev` |
| [`backend/`](backend/) | REST API: profiles, matchmaking, quests, Auth0, n8n events (Node + SQLite) | Person 2 | [backend/README.md](backend/README.md) |
| [`ai-agent/`](ai-agent/) | Quest generation service (Python) | Person 3 | `cd ai-agent && pip install -r requirements.txt && python start.py` |

Auth0 and n8n configuration (Person 4) plug into the backend via environment variables. See [backend/README.md](backend/README.md) §6 and §8.

## How the pieces connect

```
frontend ──(Auth0 access token)──▶ backend ──▶ ai-agent   (MARITIME_AGENT_URL)
                                      │
                                      └──▶ n8n webhook     (N8N_WEBHOOK_URL)
```

Each folder is independent: its own dependencies, config, and `.gitignore`. Run commands from inside the folder.
