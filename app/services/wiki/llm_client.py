from typing import Any

import httpx


def _build_chat_completion_payload(system_prompt: str, user_prompt: str, model_config: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model_config.get("model", "gpt-4o-mini"),
        "temperature": model_config.get("temperature", 0.3),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }


async def call_openai_compatible(system_prompt: str, user_prompt: str, model_config: dict[str, Any]) -> str:
    base_url = model_config.get("baseUrl", "https://api.openai.com/v1").rstrip("/")
    api_key = model_config.get("apiKey", "")

    if not api_key:
        raise ValueError("API key is required for wiki compilation")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = _build_chat_completion_payload(system_prompt, user_prompt, model_config)

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise ValueError(f"Unexpected LLM response format: {e}. Response: {str(data)[:500]}") from e
