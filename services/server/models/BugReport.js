const Base = require('./BaseModel');


class BugReport extends Base { 
    static tableName = 'bug_reports';

    // Creates a bug report within the team.
    static async create({teamId, reportedBy, source, title, desc, status}) {
        return this.insert({
            team_id: teamId, 
            reported_by: reportedBy, 
            source, 
            title,
            desc,
            status
        });
    }

    // List every bug report in the team.
    static async listByTeam(teamId, {limit = 20, offset = 0} = {}) {
        return this.table
        .where({team_id: teamId})
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
    }

    // Set the status of the specified bug report.
    static async setStatus(id, status, changeBy) {
        // updates the bug_report row itself. 
        await this.update(id, {status})

        // Record the change in bug_history. 
        await require('./BugHistory').insert(
            {
                bug_report_id: id, 
                status, 
                changed_by: changeBy
            }
        )
    }
}

module.exports = BugReport;