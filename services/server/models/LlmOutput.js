const Base = require('./BaseModel');

class LlmOutput extends Base {
    static tableName = 'llm_outputs';

    // Attaches a suggestion to a bug based on the id.
    static async addSuggestion({
        bugId, 
        text, 
        modelName = 'NAN',
        analysisType = 'suggestion',
        confidenceScore = null,
        processingTimeMs = null,
        tokenUsage = null,
        structuredOutput = null
    }) {
        return this.insert({
            bug_report_id: bugId, 
            output_type: 'suggestion', 
            model_name: modelName, 
            output_text: text,
            analysis_type: analysisType,
            confidence_score: confidenceScore,
            processing_time_ms: processingTimeMs,
            token_usage: tokenUsage,
            structured_output: structuredOutput
        });
    }

    /**
     * Create enhanced LLM output with full metadata
     */
    static async createAnalysis({
        bugReportId,
        outputType,
        modelName,
        outputText,
        analysisType,
        confidenceScore = null,
        processingTimeMs = null,
        tokenUsage = null,
        structuredOutput = null
    }) {
        return this.insert({
            bug_report_id: bugReportId,
            output_type: outputType,
            model_name: modelName,
            output_text: outputText,
            analysis_type: analysisType,
            confidence_score: confidenceScore,
            processing_time_ms: processingTimeMs,
            token_usage: tokenUsage,
            structured_output: structuredOutput
        });
    }

    // Finds the latest suggestion for the specified bug.
    static async latestForBug(bugId) {
        return this.table
        .where({bug_report_id:bugId})
        .orderBy('created_at', 'desc')
        .first();
    }

    /**
     * Get outputs by analysis type
     */
    static async getByAnalysisType(analysisType) {
        return this.findAll({ analysis_type: analysisType })
            .orderBy('created_at', 'desc');
    }

    /**
     * Get outputs with confidence score above threshold
     */
    static async getHighConfidenceOutputs(threshold = 0.8) {
        return this.query()
            .where('confidence_score', '>=', threshold)
            .orderBy('confidence_score', 'desc');
    }

    /**
     * Get performance statistics for model analysis
     */
    static async getModelPerformanceStats(modelName = null) {
        let query = this.query()
            .select(this.raw(`
                AVG(processing_time_ms) as avg_processing_time,
                MIN(processing_time_ms) as min_processing_time,
                MAX(processing_time_ms) as max_processing_time,
                AVG(confidence_score) as avg_confidence,
                COUNT(*) as total_analyses
            `))
            .whereNotNull('processing_time_ms');

        if (modelName) {
            query = query.where('model_name', modelName);
        }

        return query.first();
    }

    /**
     * Get token usage statistics
     */
    static async getTokenUsageStats(modelName = null) {
        let query = this.query()
            .select(this.raw(`
                SUM((token_usage->>'input_tokens')::int) as total_input_tokens,
                SUM((token_usage->>'output_tokens')::int) as total_output_tokens,
                AVG((token_usage->>'input_tokens')::int) as avg_input_tokens,
                AVG((token_usage->>'output_tokens')::int) as avg_output_tokens,
                COUNT(*) as total_requests
            `))
            .whereNotNull('token_usage');

        if (modelName) {
            query = query.where('model_name', modelName);
        }

        return query.first();
    }

    /**
     * Update analysis with performance metrics
     */
    async updateMetrics({
        confidenceScore = null,
        processingTimeMs = null,
        tokenUsage = null
    }) {
        const updates = {};
        if (confidenceScore !== null) updates.confidence_score = confidenceScore;
        if (processingTimeMs !== null) updates.processing_time_ms = processingTimeMs;
        if (tokenUsage !== null) updates.token_usage = tokenUsage;

        return this.update(updates);
    }

    /**
     * Get cost estimate based on token usage
     */
    getCostEstimate(inputTokenCost = 0.0001, outputTokenCost = 0.0002) {
        if (!this.token_usage) return null;

        const inputTokens = this.token_usage.input_tokens || 0;
        const outputTokens = this.token_usage.output_tokens || 0;

        return (inputTokens * inputTokenCost) + (outputTokens * outputTokenCost);
    }
}

module.exports = LlmOutput;