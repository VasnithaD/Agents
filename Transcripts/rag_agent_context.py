import os
import subprocess
from pathlib import Path
from typing import Dict, Tuple

SCRIPT_DIR = Path(__file__).parent.resolve()
MCP_CLIENT_DIR = SCRIPT_DIR / "mcp-client"
DEFAULT_RAG_DOCS = r"C:\Users\harya\Downloads\cpq-ngqc-app\cpq-ngqc-app"

_RAG_CACHE: Dict[Tuple[str, int], str] = {}


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _build_rag_query(task_label: str, prompt: str) -> str:
    trimmed_prompt = (prompt or "")[:2000]
    seed = (
        "cpq ngqc app modules services api workflow architecture "
        "data model integration business rules requirements"
    )
    return (
        f"Task: {task_label}\n"
        f"Seed terms: {seed}\n\n"
        f"Prompt:\n{trimmed_prompt}"
    ).strip()


def _retrieve_rag_context(query: str, top_k: int) -> str:
    cache_key = (query, top_k)
    if cache_key in _RAG_CACHE:
        return _RAG_CACHE[cache_key]

    if not MCP_CLIENT_DIR.exists():
        return ""

    node_script = (
        "import { initializeRAG, ragRetriever } from '../rag/retriever';"
        "(async () => {"
        "  const q = process.env.RAG_QUERY || '';"
        "  const k = parseInt(process.env.RAG_TOP_K || '5', 10);"
        "  await initializeRAG();"
        "  const ctx = await ragRetriever.retrieve(q, k);"
        "  console.log('RAG_CTX_START');"
        "  console.log(ctx || '');"
        "  console.log('RAG_CTX_END');"
        "  process.exit(0);"
        "})().catch((e) => {"
        "  console.error('[RAG_BRIDGE_ERROR]', e?.message || e);"
        "  process.exit(1);"
        "});"
    )

    env = os.environ.copy()
    env.setdefault("RAG_DOCUMENTS_PATH", os.getenv("RAG_DOCUMENTS_PATH", DEFAULT_RAG_DOCS))
    env.setdefault("RAG_INDEX_PATH", os.getenv("RAG_INDEX_PATH", str(SCRIPT_DIR / "rag-index")))
    env["RAG_QUERY"] = query
    env["RAG_TOP_K"] = str(top_k)

    node_path = str(MCP_CLIENT_DIR / "node_modules")
    if env.get("NODE_PATH"):
        env["NODE_PATH"] = env["NODE_PATH"] + os.pathsep + node_path
    else:
        env["NODE_PATH"] = node_path

    pem_path = SCRIPT_DIR / "cacert 1 (1).pem"
    if pem_path.exists() and not env.get("NODE_EXTRA_CA_CERTS"):
        env["NODE_EXTRA_CA_CERTS"] = str(pem_path)

    if os.name == "nt":
        ts_node_bin = MCP_CLIENT_DIR / "node_modules" / ".bin" / "ts-node.cmd"
    else:
        ts_node_bin = MCP_CLIENT_DIR / "node_modules" / ".bin" / "ts-node"

    if not ts_node_bin.exists():
        return ""

    try:
        proc = subprocess.run(
            [str(ts_node_bin), "--transpile-only", "-e", node_script],
            cwd=str(MCP_CLIENT_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("RAG_RETRIEVE_TIMEOUT_SEC", "900")),
            check=False,
        )
    except Exception:
        return ""

    if proc.returncode != 0:
        return ""

    out = proc.stdout or ""
    start = out.find("RAG_CTX_START")
    end = out.find("RAG_CTX_END")
    if start == -1 or end == -1 or end <= start:
        return ""

    context = out[start + len("RAG_CTX_START"):end].strip()
    _RAG_CACHE[cache_key] = context
    return context


def ground_prompt_with_rag(prompt: str, task_label: str) -> str:
    if not _bool_env("RAG_PRIMARY_ENABLED", True):
        return prompt

    top_k = int(os.getenv("RAG_TOP_K", "5"))
    query = _build_rag_query(task_label, prompt)
    context = _retrieve_rag_context(query, top_k)

    if not context:
        return prompt

    max_chars = int(os.getenv("RAG_MAX_CONTEXT_CHARS", "12000"))
    if len(context) > max_chars:
        context = context[:max_chars] + "\n\n[RAG context trimmed to fit prompt budget]"

    grounding_header = (
        "You must ground your answer using the retrieved project context below. "
        "Prefer retrieved facts over assumptions. If details are missing, state that clearly."
    )

    return (
        f"{grounding_header}\n\n"
        f"=== Retrieved Context (RAG) ===\n{context}\n"
        f"=== End Retrieved Context ===\n\n"
        f"{prompt}"
    )


def extract_related_artifacts_from_rag_context(rag_context: str) -> dict:
    """Extract related file/folder/project root from raw RAG context output."""
    result = {"related_file": "", "related_folder": "", "project_root": ""}
    if not rag_context or not rag_context.strip():
        return result

    lines = rag_context.split("\n")
    related_folders = []

    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue

        if trimmed.startswith("> Path:"):
            full_path = trimmed.replace("> Path:", "", 1).strip()
            if full_path and len(full_path) > 5 and not result["related_file"]:
                result["related_file"] = full_path
                idx = max(full_path.rfind("\\"), full_path.rfind("/"))
                if idx > 0:
                    result["related_folder"] = full_path[:idx]

        if trimmed.startswith("- "):
            path = trimmed[2:].strip()
            if path and ("\\" in path or "/" in path) and path not in related_folders:
                related_folders.append(path)

        if "rag project root:" in trimmed.lower() and not result["project_root"]:
            key_idx = trimmed.lower().find("rag project root:")
            root = trimmed[key_idx + len("rag project root:"):].replace("*", "").strip()
            if root:
                result["project_root"] = root

    if not result["related_folder"] and related_folders:
        result["related_folder"] = related_folders[0]

    if not result["related_folder"] and result["project_root"]:
        result["related_folder"] = result["project_root"]

    return result


def get_rag_related_artifacts(prompt: str, task_label: str, top_k: int = None) -> dict:
    """Retrieve RAG context for the prompt and extract related file/folder metadata."""
    if not _bool_env("RAG_PRIMARY_ENABLED", True):
        return {"related_file": "", "related_folder": "", "project_root": "", "rag_context": ""}

    resolved_top_k = top_k if top_k is not None else int(os.getenv("RAG_TOP_K", "5"))
    query = _build_rag_query(task_label, prompt)
    context = _retrieve_rag_context(query, resolved_top_k)
    artifacts = extract_related_artifacts_from_rag_context(context)
    artifacts["rag_context"] = context
    return artifacts
