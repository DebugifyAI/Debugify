const Base = require('./BaseModel');
const TeamMem = require('./TeamMember');


class Team extends Base {
    static tableName = 'teams';

    /* CRUD Operations */ 
    /* create a new team inside an organization */ 
    static async create({organizationId, name, createBy}) {
        return this.insert({organization_id: organizationId, name, created_by: createBy})
    }

    /* Rename Team */ 
    static async rename(id, newName) {
        return this.update(id, {name:newName})
    }

    /* List teams for a given organization */
    static async listByOrg(organizationId) {
        return this.findAll({organization_id: organizationId});
    }

    /* Membership Helper Functions */
    static async addMember({teamId, userId, role = 'member'}) {
        return TeamMem.add({teamId, userId, role});
    }
    static async removeMember({teamId, userId}) {
        return TeamMem.remove({teamId, userId});
    }
    static async setMemberRole({teamId,userId,role}) {
        return TeamMem.setRole({teamId, userId, role});
    }
    static async getMembers(teamId) {
        return TeamMem.membersOfTeam(teamId);
    }
    static async isOwner({teamId, userId}) {
        return TeamMem.isOwner(teamId, userId);
    }

    /* Every team that the specified user joined. */ 
    static async forUser(userId) {
        return TeamMem.teamsForUser(userId);
    }

}

module.exports = Team;