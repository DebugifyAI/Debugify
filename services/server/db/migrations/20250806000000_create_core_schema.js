/**
 * Core schema based on Debugify.sql, adapted for Postgres with Knex.
 * Notes:
 * - Keeps existing users table intact; only adds `provider` column if missing
 * - Uses integer primary keys (increments) to match existing code using numeric ids
 * - Uses text for enum/tag fields due to unspecified enum values in provided schema
 */

/** @param { import('knex').Knex } knex */
exports.up = async function up(knex) {
  // 1) Users adjustments: add provider if not exists
  await knex.schema.raw(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS provider text"
  );

  // 2) user_sessions
  const hasUserSessions = await knex.schema.hasTable('user_sessions');
  if (!hasUserSessions) {
    await knex.schema.createTable('user_sessions', (table) => {
      table.increments('id').primary(); // token in SQL schema was type 'id'; using numeric id here
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('issued_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('revoked_at', { useTz: true }).nullable();
      table.index(['user_id'], 'user_sessions_user_id_idx');
    });
  }

  // 3) organizations
  const hasOrganizations = await knex.schema.hasTable('organizations');
  if (!hasOrganizations) {
    await knex.schema.createTable('organizations', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable();
      table.integer('owner_id').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.index(['owner_id'], 'organizations_owner_id_idx');
    });
  }

  // 4) organization_members
  const hasOrgMembers = await knex.schema.hasTable('organization_members');
  if (!hasOrgMembers) {
    await knex.schema.createTable('organization_members', (table) => {
      table.increments('id').primary();
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations').onDelete('CASCADE');
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.text('role').notNullable().defaultTo('member');
      table.timestamp('joined_at', { useTz: true }).defaultTo(knex.fn.now());
      table.unique(['organization_id', 'user_id'], 'organization_members_unique_member');
      table.index(['organization_id'], 'organization_members_org_id_idx');
      table.index(['user_id'], 'organization_members_user_id_idx');
    });
  }

  // 5) org_invitations
  const hasOrgInvites = await knex.schema.hasTable('org_invitations');
  if (!hasOrgInvites) {
    await knex.schema.createTable('org_invitations', (table) => {
      table.increments('id').primary();
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations').onDelete('CASCADE');
      table.text('email').notNullable();
      table.text('role').notNullable().defaultTo('member');
      table.text('token').notNullable().unique();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamps(true, true);
      table.index(['organization_id'], 'org_invitations_org_id_idx');
      table.index(['email'], 'org_invitations_email_idx');
    });
  }

  // 6) teams
  const hasTeams = await knex.schema.hasTable('teams');
  if (!hasTeams) {
    await knex.schema.createTable('teams', (table) => {
      table.increments('id').primary();
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations').onDelete('CASCADE');
      table.text('name').notNullable();
      table.integer('created_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.index(['organization_id'], 'teams_org_id_idx');
      table.index(['created_by'], 'teams_created_by_idx');
      table.unique(['organization_id', 'name'], 'teams_org_name_unique');
    });
  }

  // 7) team_members
  const hasTeamMembers = await knex.schema.hasTable('team_members');
  if (!hasTeamMembers) {
    await knex.schema.createTable('team_members', (table) => {
      table.increments('id').primary();
      table.integer('team_id').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE');
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.text('role').notNullable().defaultTo('member');
      table.timestamp('joined_at', { useTz: true }).defaultTo(knex.fn.now());
      table.unique(['team_id', 'user_id'], 'team_members_unique_member');
      table.index(['team_id'], 'team_members_team_id_idx');
      table.index(['user_id'], 'team_members_user_id_idx');
    });
  }

  // 8) bug_reports
  const hasBugReports = await knex.schema.hasTable('bug_reports');
  if (!hasBugReports) {
    await knex.schema.createTable('bug_reports', (table) => {
      table.increments('id').primary();
      table.integer('team_id').unsigned().notNullable().references('id').inTable('teams').onDelete('CASCADE');
      table.integer('reported_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.text('source').nullable(); // schema had 'tag' type; using text
      table.text('title').notNullable();
      table.text('desc').nullable();
      table.text('status').notNullable().defaultTo('open'); // enum not specified; use text
      table.timestamps(true, true);
      table.index(['team_id'], 'bug_reports_team_id_idx');
      table.index(['reported_by'], 'bug_reports_reported_by_idx');
      table.index(['status'], 'bug_reports_status_idx');
    });
  }

  // 9) logs
  const hasLogs = await knex.schema.hasTable('logs');
  if (!hasLogs) {
    await knex.schema.createTable('logs', (table) => {
      table.increments('id').primary();
      table.integer('bug_report_id').unsigned().notNullable().references('id').inTable('bug_reports').onDelete('CASCADE');
      table.text('file_url').notNullable();
      table.timestamps(true, true);
      table.index(['bug_report_id'], 'logs_bug_report_id_idx');
    });
  }

  // 10) llm_outputs
  const hasLlmOutputs = await knex.schema.hasTable('llm_outputs');
  if (!hasLlmOutputs) {
    await knex.schema.createTable('llm_outputs', (table) => {
      table.increments('id').primary();
      table.integer('bug_report_id').unsigned().notNullable().references('id').inTable('bug_reports').onDelete('CASCADE');
      table.text('output_type').notNullable(); // enum in schema; using text
      table.text('model_name').nullable();
      table.text('output_text').nullable();
      table.timestamps(true, true);
      table.index(['bug_report_id'], 'llm_outputs_bug_report_id_idx');
      table.index(['output_type'], 'llm_outputs_output_type_idx');
    });
  }

  // 11) bug_history
  const hasBugHistory = await knex.schema.hasTable('bug_history');
  if (!hasBugHistory) {
    await knex.schema.createTable('bug_history', (table) => {
      table.increments('id').primary();
      table.integer('bug_report_id').unsigned().notNullable().references('id').inTable('bug_reports').onDelete('CASCADE');
      table.text('status').notNullable(); // enum in schema; using text
      table.integer('changed_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('changed_at', { useTz: true }).defaultTo(knex.fn.now());
      table.index(['bug_report_id'], 'bug_history_bug_report_id_idx');
      table.index(['changed_by'], 'bug_history_changed_by_idx');
    });
  }
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  // Drop in reverse dependency order
  const dropIfExists = async (name) => {
    const exists = await knex.schema.hasTable(name);
    if (exists) {
      await knex.schema.dropTable(name);
    }
  };

  await dropIfExists('bug_history');
  await dropIfExists('llm_outputs');
  await dropIfExists('logs');
  await dropIfExists('bug_reports');
  await dropIfExists('team_members');
  await dropIfExists('teams');
  await dropIfExists('org_invitations');
  await dropIfExists('organization_members');
  await dropIfExists('organizations');
  await dropIfExists('user_sessions');

  // Revert users table provider column if we added it
  // Use raw to avoid errors if column was originally present
  await knex.schema.raw(
    "ALTER TABLE users DROP COLUMN IF EXISTS provider"
  );
};


