/**
 * Create `artifacts` and `llm_output_artifacts` tables.
 */

/** @param { import('knex').Knex } knex */
exports.up = async function up(knex) {
  const hasArtifacts = await knex.schema.hasTable('artifacts');
  if (!hasArtifacts) {
    await knex.schema.createTable('artifacts', (table) => {
      table.increments('id').primary();
      table.integer('bug_report_id').unsigned().notNullable()
        .references('id').inTable('bug_reports').onDelete('CASCADE');
      table.integer('uploader_user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');

      table.text('s3_bucket').notNullable();
      table.text('s3_key').notNullable();
      table.text('content_type').nullable();
      table.integer('size_bytes').nullable();
      table.text('etag').nullable();
      table.text('checksum').nullable();

      table.text('status').notNullable().defaultTo('uploaded');
      table.jsonb('metadata').nullable();
      table.text('processing_job_id').nullable();

      table.timestamp('uploaded_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('processed_at', { useTz: true }).nullable();
      table.timestamps(true, true);

      table.unique(['bug_report_id', 's3_key'], 'artifacts_bug_s3key_unique');
      table.index(['bug_report_id'], 'artifacts_bug_report_id_idx');
      table.index(['status'], 'artifacts_status_idx');
      table.index(['uploaded_at'], 'artifacts_uploaded_at_idx');
    });
  }

  const hasLink = await knex.schema.hasTable('llm_output_artifacts');
  if (!hasLink) {
    await knex.schema.createTable('llm_output_artifacts', (table) => {
      table.increments('id').primary();
      table.integer('llm_output_id').unsigned().notNullable()
        .references('id').inTable('llm_outputs').onDelete('CASCADE');
      table.integer('artifact_id').unsigned().notNullable()
        .references('id').inTable('artifacts').onDelete('CASCADE');
      table.timestamps(true, true);

      table.unique(['llm_output_id', 'artifact_id'], 'llm_output_artifacts_unique');
      table.index(['llm_output_id'], 'llm_output_artifacts_output_idx');
      table.index(['artifact_id'], 'llm_output_artifacts_artifact_idx');
    });
  }
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  const dropIfExists = async (name) => {
    const exists = await knex.schema.hasTable(name);
    if (exists) {
      await knex.schema.dropTable(name);
    }
  };

  await dropIfExists('llm_output_artifacts');
  await dropIfExists('artifacts');
};


