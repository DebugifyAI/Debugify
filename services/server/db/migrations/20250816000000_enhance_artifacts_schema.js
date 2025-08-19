/**
 * Enhance artifacts table for advanced tracking and create processing_jobs table.
 * Adds validation status, parsed content, processing stages, image-specific columns,
 * and comprehensive job tracking capabilities.
 */

/** @param { import('knex').Knex } knex */
exports.up = async function up(knex) {
  // Enhance artifacts table with new columns for advanced tracking
  await knex.schema.alterTable('artifacts', (table) => {
    // Validation and processing status columns
    table.text('validation_status').defaultTo('pending');
    table.jsonb('validation_errors').nullable();
    table.text('parsed_content_s3_key').nullable();
    table.text('content_summary').nullable();
    table.jsonb('processing_stages').defaultTo('[]');
    table.integer('retry_count').defaultTo(0);
    table.text('last_error').nullable();

    // Image-specific columns for comprehensive image processing
    table.jsonb('image_variants').nullable(); // Store S3 keys for different image sizes/formats
    table.jsonb('image_metadata').nullable(); // EXIF, dimensions, color info, camera data
    table.text('ocr_text').nullable(); // Extracted text from images via OCR
    table.jsonb('visual_elements').nullable(); // Detected UI components, charts, diagrams
    table.jsonb('sensitive_data_flags').nullable(); // PII, credentials detection results
  });

  // Add performance indexes for new columns
  await knex.schema.alterTable('artifacts', (table) => {
    table.index(['validation_status'], 'artifacts_validation_status_idx');
    table.index(['retry_count'], 'artifacts_retry_count_idx');
    table.index(['parsed_content_s3_key'], 'artifacts_parsed_content_idx');
  });

  // Create processing_jobs table for detailed job tracking and monitoring
  const hasProcessingJobs = await knex.schema.hasTable('processing_jobs');
  if (!hasProcessingJobs) {
    await knex.schema.createTable('processing_jobs', (table) => {
      table.increments('id').primary();
      table.text('job_id').unique().notNullable(); // BullMQ job ID
      table.integer('artifact_id').unsigned().notNullable()
        .references('id')
        .inTable('artifacts')
        .onDelete('CASCADE');
      table.text('job_type').notNullable(); // validation, parsing, image, llm, cleanup
      table.text('status').defaultTo('queued'); // queued, active, completed, failed, delayed
      table.integer('progress').defaultTo(0); // 0-100 percentage
      table.timestamp('started_at', { useTz: true }).nullable();
      table.timestamp('completed_at', { useTz: true }).nullable();
      table.jsonb('error_details').nullable(); // Structured error information
      table.jsonb('result_data').nullable(); // Job-specific result data
      table.timestamps(true, true);

      // Performance indexes
      table.index(['job_id'], 'processing_jobs_job_id_idx');
      table.index(['artifact_id'], 'processing_jobs_artifact_id_idx');
      table.index(['job_type'], 'processing_jobs_job_type_idx');
      table.index(['status'], 'processing_jobs_status_idx');
      table.index(['started_at'], 'processing_jobs_started_at_idx');
      table.index(['completed_at'], 'processing_jobs_completed_at_idx');
      // Composite indexes for common queries
      table.index(['artifact_id', 'job_type'], 'processing_jobs_artifact_type_idx');
      table.index(['status', 'job_type'], 'processing_jobs_status_type_idx');
    });
  }

  // Enhance llm_outputs table with additional analysis metadata
  await knex.schema.alterTable('llm_outputs', (table) => {
    table.text('analysis_type').nullable(); // log_analysis, code_review, image_analysis, etc.
    table.decimal('confidence_score', 3, 2).nullable(); // 0.00 to 1.00
    table.integer('processing_time_ms').nullable(); // Processing duration in milliseconds
    table.jsonb('token_usage').nullable(); // Input/output token counts and costs
    table.jsonb('structured_output').nullable(); // Parsed/structured analysis results
  });

  // Add indexes for enhanced llm_outputs columns
  await knex.schema.alterTable('llm_outputs', (table) => {
    table.index(['analysis_type'], 'llm_outputs_analysis_type_idx');
    table.index(['confidence_score'], 'llm_outputs_confidence_score_idx');
  });
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  // Drop processing_jobs table
  const hasProcessingJobs = await knex.schema.hasTable('processing_jobs');
  if (hasProcessingJobs) {
    await knex.schema.dropTable('processing_jobs');
  }

  // Remove enhanced columns from llm_outputs table
  await knex.schema.alterTable('llm_outputs', (table) => {
    table.dropIndex(['confidence_score'], 'llm_outputs_confidence_score_idx');
    table.dropIndex(['analysis_type'], 'llm_outputs_analysis_type_idx');
    table.dropColumn('structured_output');
    table.dropColumn('token_usage');
    table.dropColumn('processing_time_ms');
    table.dropColumn('confidence_score');
    table.dropColumn('analysis_type');
  });

  // Remove enhanced columns from artifacts table
  await knex.schema.alterTable('artifacts', (table) => {
    // Drop indexes first
    table.dropIndex(['parsed_content_s3_key'], 'artifacts_parsed_content_idx');
    table.dropIndex(['retry_count'], 'artifacts_retry_count_idx');
    table.dropIndex(['validation_status'], 'artifacts_validation_status_idx');

    // Drop image-specific columns
    table.dropColumn('sensitive_data_flags');
    table.dropColumn('visual_elements');
    table.dropColumn('ocr_text');
    table.dropColumn('image_metadata');
    table.dropColumn('image_variants');

    // Drop processing and validation columns
    table.dropColumn('last_error');
    table.dropColumn('retry_count');
    table.dropColumn('processing_stages');
    table.dropColumn('content_summary');
    table.dropColumn('parsed_content_s3_key');
    table.dropColumn('validation_errors');
    table.dropColumn('validation_status');
  });
};