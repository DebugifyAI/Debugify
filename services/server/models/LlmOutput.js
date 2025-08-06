const Base = require('./BaseModel');


class LlmOutput extends Base {
    static tableName = 'llm_outputs';

    // Attaches a suggestion to a bug based on the id.
    static async addSuggestion ({bugId, text, modelName = 'NAN'}) {
        return this.insert({
            bug_report_id: bugId, 
            output_type: 'suggestion', 
            model_name: modelName, 
            output_text: text
        });
    }
 // Finds the latest suggestion for the specified bug.
    static async latestForBug(bugId) {
        return this.table
        .where({bug_report_id:bugId})
        .orderBy('created_at', 'desc')
        .first();
    }
}

module.exports = LlmOutput;