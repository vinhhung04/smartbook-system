"""Shared AI Core of ai-service: the parts the General AI Chatbot (/chat,
/chat/stream) and the AI Decision Assistant (/assistant, /assistant/stream)
both use, each in ONE place. The two experiences keep their own
orchestration (chat: NLU -> retrieval/RAG -> one LLM call; assistant:
planner -> tool loop -> verification), their own prompts, conversations,
caches and access gates - sharing a component never shares a permission.

    policy          who may do what: identity, rate limit, assistant gate,
                    action confirm policy, warehouse scope (ai_core/policy.py)
    tools           the tool registry and the one place a model-requested
                    read tool is validated, executed, timed and logged
    prompts         named, versioned system prompts per use case
    observability   request id carried from the gateway into every log line

Shared modules that already existed and stay where they are:
    llm_provider.py     LLM provider layer (OpenRouter models, retry, fallback
                        model, streaming, token usage, metrics)
    retrieval.py / faq_retrieval.py / retrieval_confidence.py   retrieval layer
    rag.py              grounding rules, numeric grounding, abstention fallback
    agent_store.py / action_guard.py / agent_executor.py        controlled execution
"""
