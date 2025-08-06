const Base = require('./BaseModel');

class OrganizationMember extends Base {
    static tableName = 'organizations_members';

    /* CRUD Helper functions */
    static async add({organizationId, userId, role = 'member'}) {
        return this.insert({organization_id: organizationId, user_id: userId, role});
    }
    static async remove({organizationId, userId}) {
        return this.where({organization_id: organizationId, user_id: userId}).del();
    }
    static async setRole({organizationId, userId, role}) {
        return this.updateComposite({organization_id: organizationId, user_id: userId, role}, { role });
    }

    /* Utility functions */ 
    static async membersOfOrg(organizationId) {
        return this.table
        .select('users.id', 'users.email', 'organizations_members.role', 'joined_at')
        .join('users','user.id','organization_members.user_id')
        .where('organization_id', organizationId)
        .orderBy('joined_at','asc');
    }
    static async orgsForUser(userId) {
        return this.table
        .select('organizations.*', 'organization_members.role')
        .join('organizations','organizations.id','organization_members.organization_id')
        .where('organization_members.user_id', userId)
    }

    static async isAdmin (organizationId, userId) {
        const row = await this.table
        .where({organization_id: organizationId, user_id: userId})
        .whereIn('role', ['owner', 'admin'])
        .first();
        return !!row;
    }
}

module.exports = OrganizationMember