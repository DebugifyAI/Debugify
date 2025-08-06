const Base = require('./BaseModel');

class BugHistory extends Base {
    static tableName = 'bug_history'


    /* Create a history record */ 
    static async record({bugId, status, changedBy = null}, trx = this.table) {
        return this.insert({
            bug_report_id: bugId, 
            status, 
            changed_by: changedBy
        }), 
        trx
    };

   /* Utility functions */
   /* Full timeline for one bug */ 
   static async listForBug(bugId) {
    return this.table
    .select('status', 'changed_by', 'changed_at')
    .where({bug_report_id:bugId})
    .orderBy('changed_at', 'asc');
   }

   /* Latest status row. */
   static async latest(bugId) {
    return this.table 
    .where({bug_report_id: bugId})
    .orderBy('changed_at', 'desc')
    .first();
   }
}

module.exports = BugHistory;