# Conway Automaton - Provider-Agnostic Inference Layer

## Goal
Replace Conway's proprietary API with a multi-provider inference layer allowing users to pick their own provider (OpenAI, Anthropic, Groq, Ollama).

## Current State Analysis ✅
- **Existing infrastructure examined**
  - `src/inference/router.ts` - Routes through `inference.chat()` callback to Conway API
  - `src/conway/inference.ts` - Current Conway API client with some OpenAI/Anthropic support
  - Agent loop calls `inferenceRouter.route()` with Conway inference as callback
  - Config has `ModelStrategyConfig` but missing provider selection fields

## Progress Tracker

### ✅ Phase 1: Analysis & Planning (DONE)
- [x] Analyzed current inference architecture
- [x] Identified Conway API integration points
- [x] Reviewed existing type definitions
- [x] Identified required config changes

### ✅ Phase 2: Provider Interface & Implementations (DONE)
- [x] Create `src/inference/providers/provider-interface.ts`
- [x] Implement `openai-provider.ts`
- [x] Implement `anthropic-provider.ts`
- [x] Implement `groq-provider.ts`
- [x] Implement `ollama-provider.ts`

### ✅ Phase 3: Router Modification (DONE)
- [x] Update `InferenceRouter` to use providers directly
- [x] Add ProviderManager integration to router
- [x] Maintain backward compatibility with Conway callback mode

### ✅ Phase 4: Configuration Updates (DONE)
- [x] Update `ModelStrategyConfig` with provider fields
- [x] Update `types.ts` with new config fields
- [x] Update `ModelProvider` type to include new providers
- [x] Update default configs in both `types.ts` and `inference/types.ts`

### ⏳ Phase 5: Testing & Documentation
- [ ] Build and fix TypeScript errors
- [ ] Update README.md with setup instructions
- [ ] Test with different providers
- [ ] Commit and push changes

## Next Steps
Starting with provider interface design and OpenAI implementation.