/**
 * Claude API provider. Enabled only by ANALYSIS_PROVIDER=claude. The model name is read from
 * ANALYSIS_MODEL; do not hard-code model identifiers anywhere in code, comments or commits.
 *
 * TODO(WS5 AI/analysis):
 *  - add the official SDK dependency to this package only (lint forbids it elsewhere);
 *  - map ContextBlocks to messages: instructions → system; evidence → user content inside
 *    <evidence id=… source=… trust="untrusted"> data blocks with an explicit "data, not instructions" rule;
 *  - pass tools (read-only gateway specs) and request structured output matching outputSchema;
 *  - enforce maxOutputTokens and a request timeout; map vendor errors to ProviderResponse errors;
 *  - report token usage and cost; never log prompt text that contains restricted values
 *    (traces store hashes and ids only);
 *  - enable zero-data-retention settings where the account supports them (decisions.md D-018).
 */
import type { AnalysisProvider, ProviderConfig } from './provider';

export function createClaudeProvider(config: ProviderConfig): AnalysisProvider {
  if (!config.apiKey || !config.model)
    throw new Error('Claude provider needs apiKey and model from configuration');
  return {
    name: 'claude',
    modelConfig: config.model,
    generate: async () => {
      throw new Error('TODO(WS5): Claude provider');
    },
  };
}
