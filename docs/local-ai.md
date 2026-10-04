# Local AI for manual shelf imports

Local Qwen is an optional classifier for manually imported reading records. Bilibili selection uses the separate Codex collection workflow. Inspiration conversations are retired; idea capture, fusion and repository creation do not depend on a model.

The default model identifier is `hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M`. It uses the [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) model and [Unsloth GGUF quantization](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF); the quantization publisher differs from the original model publisher. Model downloads and memory needs are separate from the website installation and vary by device/context.

## Windows installation and lifecycle

```powershell
powershell -ExecutionPolicy Bypass -File scripts/Install-LocalAI.ps1
```

The checked-in installer pins official Ollama v0.34.4 Windows portable runtime and its SHA256, then pulls the default GGUF model. Unverified runtime archives are not executed. A failed model pull can resume by rerunning; an incomplete/corrupt runtime archive must be removed before retrying, as the script's error explains.

Files stay in Git-ignored `.runtime/local-ai/`. `Start.cmd` starts an installed managed service; `Stop.cmd` stops only its verified owned process. `scripts/Start-LocalAI.ps1` and `scripts/Stop-LocalAI.ps1` are independent controls. Process path/start time prevent stale PID termination. An existing external Ollama service may be used without taking over its lifecycle or settings.

The managed service binds to `127.0.0.1:11434` with `OLLAMA_NO_CLOUD=1`, one loaded model/request and an 8192 context limit. The frontend accesses it through the local backend. Installed-model inference has no cloud fallback or API key requirement; runtime/model downloads need network access. An external service retains its own configuration.

Mac needs a separately installed local Ollama/model; the Windows portable runtime is not transferable. No Mac model-install automation is bundled. Missing/unavailable inference preserves ordinary shelf use and manual categorization.

`INSPIRATION_MODEL` and `INSPIRATION_OLLAMA_PORT` in private `backend/.env.local` retain their legacy names but configure shelf classification. Install any overridden model separately. Configuration alone is not proof that a model is available.

## Classification scope and consistency

One durable worker classifies up to eight saved items per batch. It receives bounded title, URL, notes and Markdown/TXT opening excerpts. PDF/EPUB body extraction and video transcript/watching are not implemented. The classifier uses temperature zero, structured output, at most 1800 generated tokens and a 120-second timeout.

High-confidence usable results update categories. Medium/low confidence preserves the current category without a user-review queue. Failures retain items and allow explicit retry/manual editing. Manual choices and edits made during inference take precedence; stale responses cannot overwrite them. Pending work resumes after restart, and failed work waits for an explicit retry. Closing the website does not stop a running backend worker.

Qwen never decides Bilibili's time/progress eligibility. Model inputs, installed files, queue state and logs are private and must not enter Git. See [imports and ownership](reading-import.md) and [privacy](../PRIVACY.md).
