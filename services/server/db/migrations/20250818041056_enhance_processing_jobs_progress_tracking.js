/**
 * Enhance processing_jobs table for real-time progress tracking
 * Adds columns for stage tracking, metadata, and progress details
 */

/** @param { import('knex').Knex } knex */
exports.up = async function up(knex) {
  // Add progress tracking columns to processing_jobs table
  await knex.schema.alterTable('processing_jobs', (table) => {
    table.text('current_stage').nullable(); // Current processing stage name
    table.jsonb('stage_metadata').nullable(); // Stage-specific metadata and details
    table.integer('processing_time_ms').nullable(); // Total processing time in milliseconds
    table.text('retry_job_id').nullable(); // Reference to retry job if this job was retried
    table.timestamp('retried_at', { useTz: true }).nullable(); // When this job was retried
  });

  // Add indexes for new columns
  await knex.schema.alterTable('processing_jobs', (table) => {
    table.index(['current_stage'], 'processing_jobs_current_stage_idx');
    table.index(['retry_job_id'], 'processing_jobs_retry_job_id_idx');
    table.index(['retried_at'], 'processing_jobs_retried_at_idx');
  });
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  // Remove progress tracking columns
  await knex.schema.alterTable('processing_jobs', (table) => {
    table.dropIndex(['current_stage'], 'processing_jobs_current_stage_idx');
    table.dropIndex(['retry_job_id'], 'processing_jobs_retry_job_id_idx');
    table.dropIndex(['retried_at'], 'processing_jobs_retried_at_idx');
    
    table.dropColumn('current_stage');
    table.dropColumn('stage_metadata');
    table.dropColumn('processing_time_ms');
    table.dropColumn('retry_job_id');
    table.dropColumn('retried_at');
  });
};