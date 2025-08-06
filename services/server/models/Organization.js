const Base = require('./BaseModel');
const OrgMem = require('./OrganizationMember');
const Team = require('./Team');

class Organization extends Base{
    static tableName = 'organizations';

    /* CRUD operations */ 
    /* Creates an org and owner membership in one DB transaction. */
    static async create({name, ownerId}, trx = this.table) {
        return trx.transactions(async (t) => {
            const org = await this.insert({name, owner_id: ownerId}, t);
            OrgMem.add({organizationId: org.id, userId, role : 'owner'}, t);
            return org;
        })
    }

    /* Renames the org */
    static async rename(id, newName) {
        return this.update(id, {name:newName});
    }

    /* Deletes the org and cascades everything. */  
    static async destroy(id) {
        return this.table.where({id}).del();
    }

    /* Membership helper functions */
    static async addMember({organizationId, userId, role="member"}) {
        return OrgMem.add({organizationId, userId, role});
    }
    static async removeMember({organizationId, userId}) {
        return OrgMem.remove({organizationId, userId});
    }
    static async setMemberRole({organizationId, userId, role}) {
        return OrgMem.add({organizationId, userId, role});
    }
    static async getMembers({organizationId}) {
        return OrgMem.membersOfOrg(organizationId);
    }
    static async isAdmin(organizationId, userId) {
        return OrgMem.isAdmin({organizationId, userId, role});
    }
    /* Team Helper functions for team under this organization. */
    static async createTeam({organizationId, name, createdBy}) {
        return Team.create({organizationId,name, createdBy});
    }

    /* Every organization (and role) a user belongs to */
    static async forUser(userId) {
        return OrgMem.orgsForUser(userId);
    }
}

module.exports = Organization;