const Base = require('./BaseModel');

class LlmOutputArtifact extends Base {
  static tableName = 'llm_output_artifacts';

  static async link({ llmOutputId, artifactId }) {
    return this.insert({ llm_output_id: llmOutputId, artifact_id: artifactId });
  }

  static async findArtifactsForOutput(llmOutputId) {
    return this.findAll({ llm_output_id: llmOutputId });
  }

  static async findOutputsForArtifact(artifactId) {
    return this.findAll({ artifact_id: artifactId });
  }
}

module.exports = LlmOutputArtifact;


