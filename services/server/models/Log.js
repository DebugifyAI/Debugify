const Base = require('./BaseModel');

class Log extends Base {
    static tableName = 'logs'; 

    // Attaches the file URL and timestamp.
    static async attachToBug({bugId, fileUrl, uploadedBy}) {
        return this.insert({
            bug_report_id: bugId, 
            file_url: fileUrl, 
            uploaded_by: uploadedBy
        })
    }

    static async forBug(bugId) {
        return this.findAll({ bug_report_id: bugId});
    }

}

module.exports = Log;